package com.example.finance;

import java.math.BigDecimal;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;

/**
 * Category totals, leftover, and over-budget flags for a given month.
 * Takes the month explicitly (never assumes "now") so a future history view
 * can call this the same way for any past month.
 */
public class BudgetService {

    private final CategoryRepository categoryRepository;
    private final TransactionRepository transactionRepository;
    private final RecurringObligationService recurringObligationService;

    public BudgetService(CategoryRepository categoryRepository, TransactionRepository transactionRepository) {
        this(categoryRepository, transactionRepository, null);
    }

    public BudgetService(CategoryRepository categoryRepository, TransactionRepository transactionRepository,
                          RecurringObligationService recurringObligationService) {
        this.categoryRepository = categoryRepository;
        this.transactionRepository = transactionRepository;
        this.recurringObligationService = recurringObligationService;
    }

    public List<CategoryTotal> categoryTotals(YearMonth month) {
        List<CategoryTotal> totals = new ArrayList<>();
        for (Category category : categoryRepository.findAll()) {
            BigDecimal transactionActual = sumTransactions(month, TransactionType.EXPENSE, category.getName());
            BigDecimal recurring = recurringObligationService == null
                    ? BigDecimal.ZERO
                    : recurringObligationService.monthlyEquivalentForCategory(category.getName(), month);
            totals.add(new CategoryTotal(category, transactionActual, recurring));
        }
        return totals;
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
                .filter(t -> t.getType() == type)
                .filter(t -> categoryName == null || t.getCategoryName().equals(categoryName))
                .filter(t -> YearMonth.from(t.getDate()).equals(month))
                .map(Transaction::getAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    public static class CategoryTotal {
        private final Category category;
        private final BigDecimal transactionActual;
        private final BigDecimal recurringMonthlyEquivalent;

        public CategoryTotal(Category category, BigDecimal transactionActual) {
            this(category, transactionActual, BigDecimal.ZERO);
        }

        public CategoryTotal(Category category, BigDecimal transactionActual, BigDecimal recurringMonthlyEquivalent) {
            this.category = category;
            this.transactionActual = transactionActual;
            this.recurringMonthlyEquivalent = recurringMonthlyEquivalent;
        }

        public Category getCategory() {
            return category;
        }

        public BigDecimal getTransactionActual() {
            return transactionActual;
        }

        public BigDecimal getRecurringMonthlyEquivalent() {
            return recurringMonthlyEquivalent;
        }

        public BigDecimal getActual() {
            return transactionActual.add(recurringMonthlyEquivalent);
        }

        public BigDecimal getRemaining() {
            return category.getMonthlyTarget().subtract(getActual());
        }

        public boolean isOverBudget() {
            return getActual().compareTo(category.getMonthlyTarget()) > 0;
        }
    }
}
