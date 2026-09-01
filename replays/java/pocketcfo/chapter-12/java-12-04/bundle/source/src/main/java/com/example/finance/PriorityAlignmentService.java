package com.example.finance;

import java.time.YearMonth;
import java.util.Comparator;
import java.util.List;

/**
 * Two views of the same categories for a given month: the idealized order
 * the user set via priority numbers, and the actual order those same
 * categories (and everyone else) fall into once real spend is ranked — so
 * the user can visually compare "what I meant to prioritize" against
 * "where my money actually went."
 */
public class PriorityAlignmentService {

    private final BudgetService budgetService;

    public PriorityAlignmentService(BudgetService budgetService) {
        this.budgetService = budgetService;
    }

    /** Prioritized categories only, sorted by priority ascending (1 = highest). */
    public List<BudgetService.CategoryTotal> idealizedPriorityList(YearMonth month) {
        return budgetService.categoryTotals(month).stream()
                .filter(t -> !t.isIncomeOnly())
                .filter(t -> t.getCategory().getPriority().isPresent())
                .sorted(Comparator.<BudgetService.CategoryTotal>comparingInt(t -> t.getCategory().getPriority().orElseThrow())
                        .thenComparing(t -> t.getCategory().getName()))
                .toList();
    }

    /** Every spending category (prioritized or not), sorted by actual spend descending. */
    public List<BudgetService.CategoryTotal> actualSpendList(YearMonth month) {
        return budgetService.categoryTotals(month).stream()
                .filter(t -> !t.isIncomeOnly())
                .sorted(Comparator.comparing(BudgetService.CategoryTotal::getActual, Comparator.reverseOrder())
                        .thenComparing(t -> t.getCategory().getName()))
                .toList();
    }
}
