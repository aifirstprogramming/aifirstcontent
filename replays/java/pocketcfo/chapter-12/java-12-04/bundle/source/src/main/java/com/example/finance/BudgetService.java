package com.example.finance;

import java.math.BigDecimal;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Category totals, leftover, and over-budget flags for a given month.
 * Takes the month explicitly (never assumes "now") so a future history view
 * can call this the same way for any past month. A category's actual
 * includes its own logged transactions, plus any transaction tagged
 * directly to a savings goal or obligation that's assigned to it.
 */
public class BudgetService {

    private final CategoryRepository categoryRepository;
    private final TransactionRepository transactionRepository;
    private final SavingsGoalRepository savingsGoalRepository;
    private final RecurringObligationRepository recurringObligationRepository;

    public BudgetService(CategoryRepository categoryRepository, TransactionRepository transactionRepository,
                          SavingsGoalRepository savingsGoalRepository,
                          RecurringObligationRepository recurringObligationRepository) {
        this.categoryRepository = categoryRepository;
        this.transactionRepository = transactionRepository;
        this.savingsGoalRepository = savingsGoalRepository;
        this.recurringObligationRepository = recurringObligationRepository;
    }

    public List<CategoryTotal> categoryTotals(YearMonth month) {
        List<CategoryTotal> totals = new ArrayList<>();
        for (Category category : categoryRepository.findAll()) {
            // Categories don't carry an income/expense type, so a category's
            // actual is every transaction logged against it, whichever way
            // the money moved — otherwise an income category (e.g. a
            // paycheck) would always show zero actual.
            BigDecimal actual = sumTransactions(month, month, null, category.getName());
            totals.add(new CategoryTotal(category, actual, isIncomeOnlyCategory(category.getName())));
        }
        return totals;
    }

    /**
     * True if every transaction ever logged against this category is
     * income (e.g. a "Paycheck" category) — used to keep income out of
     * spending-oriented views like charts without needing a stored
     * category type.
     */
    private boolean isIncomeOnlyCategory(String categoryName) {
        List<Transaction> matching = transactionRepository.findAll().stream()
                .filter(t -> resolveCategoryName(t.getCategoryName()).equals(categoryName))
                .toList();
        return !matching.isEmpty() && matching.stream().allMatch(t -> t.getType() == TransactionType.INCOME);
    }

    /**
     * Maps a raw Transaction.categoryName to the category it should count
     * against: itself if it's already a real category, else the assigned
     * category of the savings goal or obligation it names, else left as-is
     * (an orphaned/typo'd tag — same graceful no-op as an unmatched name
     * always was).
     */
    private String resolveCategoryName(String rawCategoryName) {
        boolean isRealCategory = categoryRepository.findAll().stream()
                .anyMatch(c -> c.getName().equals(rawCategoryName));
        if (isRealCategory) {
            return rawCategoryName;
        }
        Optional<SavingsGoal> goal = savingsGoalRepository.findAll().stream()
                .filter(g -> g.getName().equals(rawCategoryName))
                .findFirst();
        if (goal.isPresent()) {
            return goal.get().getCategoryName();
        }
        Optional<RecurringObligation> obligation = recurringObligationRepository.findAll().stream()
                .filter(o -> o.getName().equals(rawCategoryName))
                .findFirst();
        if (obligation.isPresent()) {
            return obligation.get().getCategoryName();
        }
        return rawCategoryName;
    }

    public BigDecimal totalIncome(YearMonth month) {
        return totalIncome(month, month);
    }

    public BigDecimal totalIncome(YearMonth from, YearMonth to) {
        return sumTransactions(from, to, TransactionType.INCOME, null);
    }

    public BigDecimal totalExpenses(YearMonth month) {
        return totalExpenses(month, month);
    }

    public BigDecimal totalExpenses(YearMonth from, YearMonth to) {
        return sumTransactions(from, to, TransactionType.EXPENSE, null);
    }

    public BigDecimal leftover(YearMonth month) {
        return leftover(month, month);
    }

    public BigDecimal leftover(YearMonth from, YearMonth to) {
        return totalIncome(from, to).subtract(totalExpenses(from, to));
    }

    /**
     * Year-to-date category actuals through the given month, with each
     * category's target scaled by months elapsed so YTD over/under-budget
     * stays an apples-to-apples comparison instead of always looking
     * trivially under budget.
     */
    public List<YtdCategoryTotal> categoryTotalsYearToDate(YearMonth throughMonth) {
        YearMonth from = YearMonth.of(throughMonth.getYear(), 1);
        BigDecimal monthsElapsed = BigDecimal.valueOf(throughMonth.getMonthValue());
        List<YtdCategoryTotal> totals = new ArrayList<>();
        for (Category category : categoryRepository.findAll()) {
            BigDecimal actual = sumTransactions(from, throughMonth, null, category.getName());
            BigDecimal scaledTarget = category.getMonthlyTarget().multiply(monthsElapsed);
            totals.add(new YtdCategoryTotal(category, actual, scaledTarget, isIncomeOnlyCategory(category.getName())));
        }
        return totals;
    }

    private BigDecimal sumTransactions(YearMonth from, YearMonth to, TransactionType type, String categoryName) {
        return transactionRepository.findAll().stream()
                .filter(t -> type == null || t.getType() == type)
                .filter(t -> categoryName == null || resolveCategoryName(t.getCategoryName()).equals(categoryName))
                .filter(t -> {
                    YearMonth transactionMonth = YearMonth.from(t.getDate());
                    return !transactionMonth.isBefore(from) && !transactionMonth.isAfter(to);
                })
                .map(Transaction::getAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    public static class CategoryTotal {
        private final Category category;
        private final BigDecimal actual;
        private final boolean incomeOnly;

        public CategoryTotal(Category category, BigDecimal actual) {
            this(category, actual, false);
        }

        public CategoryTotal(Category category, BigDecimal actual, boolean incomeOnly) {
            this.category = category;
            this.actual = actual;
            this.incomeOnly = incomeOnly;
        }

        public Category getCategory() {
            return category;
        }

        public BigDecimal getActual() {
            return actual;
        }

        public BigDecimal getRemaining() {
            return category.getMonthlyTarget().subtract(actual);
        }

        public boolean isOverBudget() {
            return actual.compareTo(category.getMonthlyTarget()) > 0;
        }

        public boolean isIncomeOnly() {
            return incomeOnly;
        }
    }

    public static class YtdCategoryTotal {
        private final Category category;
        private final BigDecimal actual;
        private final BigDecimal scaledTarget;
        private final boolean incomeOnly;

        public YtdCategoryTotal(Category category, BigDecimal actual, BigDecimal scaledTarget, boolean incomeOnly) {
            this.category = category;
            this.actual = actual;
            this.scaledTarget = scaledTarget;
            this.incomeOnly = incomeOnly;
        }

        public Category getCategory() {
            return category;
        }

        public BigDecimal getActual() {
            return actual;
        }

        public BigDecimal getScaledTarget() {
            return scaledTarget;
        }

        public BigDecimal getRemaining() {
            return scaledTarget.subtract(actual);
        }

        public boolean isOverBudget() {
            return actual.compareTo(scaledTarget) > 0;
        }

        public boolean isIncomeOnly() {
            return incomeOnly;
        }
    }
}
