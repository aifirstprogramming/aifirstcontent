package com.example.finance;

import java.math.BigDecimal;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;

/**
 * Category totals, leftover, and over-budget flags for a given month.
 * Takes the month explicitly (never assumes "now") so a future history view
 * can call this the same way for any past month. A category's actual is
 * strictly its own logged transactions — obligations are their own
 * categories now, so there's nothing else to fold in.
 */
public class BudgetService {

    private final CategoryRepository categoryRepository;
    private final TransactionRepository transactionRepository;

    public BudgetService(CategoryRepository categoryRepository, TransactionRepository transactionRepository) {
        this.categoryRepository = categoryRepository;
        this.transactionRepository = transactionRepository;
    }

    public List<CategoryTotal> categoryTotals(YearMonth month) {
        List<CategoryTotal> totals = new ArrayList<>();
        for (Category category : categoryRepository.findAll()) {
            // Categories don't carry an income/expense type, so a category's
            // actual is every transaction logged against it, whichever way
            // the money moved — otherwise an income category (e.g. a
            // paycheck) would always show zero actual.
            BigDecimal actual = sumTransactions(month, null, category.getName());
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
                .filter(t -> t.getCategoryName().equals(categoryName))
                .toList();
        return !matching.isEmpty() && matching.stream().allMatch(t -> t.getType() == TransactionType.INCOME);
    }

    public BigDecimal totalIncome(YearMonth month) {
        return sumTransactions(month, TransactionType.INCOME, null);
    }

    public BigDecimal totalExpenses(YearMonth month) {
        return sumTransactions(month, TransactionType.EXPENSE, null);
    }

    public BigDecimal leftover(YearMonth month) {
        return totalIncome(month).subtract(totalExpenses(month));
    }

    private BigDecimal sumTransactions(YearMonth month, TransactionType type, String categoryName) {
        return transactionRepository.findAll().stream()
                .filter(t -> type == null || t.getType() == type)
                .filter(t -> categoryName == null || t.getCategoryName().equals(categoryName))
                .filter(t -> YearMonth.from(t.getDate()).equals(month))
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
}
