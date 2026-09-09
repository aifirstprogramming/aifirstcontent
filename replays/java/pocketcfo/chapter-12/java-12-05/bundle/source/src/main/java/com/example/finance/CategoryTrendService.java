package com.example.finance;

import java.math.BigDecimal;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Three-month actual-spend history per category, ending at a given month,
 * so the user can spot a category that's been climbing or falling for a
 * few months running and decide whether to adjust it.
 */
public class CategoryTrendService {

    private final BudgetService budgetService;

    public CategoryTrendService(BudgetService budgetService) {
        this.budgetService = budgetService;
    }

    public List<CategoryTrend> trendsThroughMonth(YearMonth endingMonth) {
        YearMonth firstMonth = endingMonth.minusMonths(2);
        YearMonth secondMonth = endingMonth.minusMonths(1);

        Map<String, BigDecimal> firstByName = actualsByName(firstMonth);
        Map<String, BigDecimal> secondByName = actualsByName(secondMonth);

        List<CategoryTrend> trends = new ArrayList<>();
        for (BudgetService.CategoryTotal total : budgetService.categoryTotals(endingMonth)) {
            if (total.isIncomeOnly()) {
                continue;
            }
            String name = total.getCategory().getName();
            trends.add(new CategoryTrend(total.getCategory(),
                    new MonthAmount(firstMonth, firstByName.getOrDefault(name, BigDecimal.ZERO)),
                    new MonthAmount(secondMonth, secondByName.getOrDefault(name, BigDecimal.ZERO)),
                    new MonthAmount(endingMonth, total.getActual())));
        }
        return trends;
    }

    // Categories aren't month-scoped, so every month has the same set of
    // category names — a category with no transactions in a given month
    // just isn't a key here, and the caller defaults it to zero.
    private Map<String, BigDecimal> actualsByName(YearMonth month) {
        Map<String, BigDecimal> actuals = new HashMap<>();
        for (BudgetService.CategoryTotal total : budgetService.categoryTotals(month)) {
            actuals.put(total.getCategory().getName(), total.getActual());
        }
        return actuals;
    }

    public record MonthAmount(YearMonth month, BigDecimal amount) {
    }

    public static class CategoryTrend {
        private final Category category;
        private final List<MonthAmount> monthAmounts;

        public CategoryTrend(Category category, MonthAmount... monthAmounts) {
            this.category = category;
            this.monthAmounts = List.of(monthAmounts);
        }

        public Category getCategory() {
            return category;
        }

        /** Oldest to newest; always exactly 3. */
        public List<MonthAmount> getMonthAmounts() {
            return monthAmounts;
        }
    }
}
