package com.example.finance;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;

/**
 * Thin facade assembling BudgetService/SavingsGoalService/RecurringObligationService
 * output into one object for the month summary dashboard.
 */
public class MonthSummaryService {

    private final BudgetService budgetService;
    private final SavingsGoalService savingsGoalService;
    private final RecurringObligationService recurringObligationService;
    private final PriorityAlignmentService priorityAlignmentService;

    public MonthSummaryService(BudgetService budgetService, SavingsGoalService savingsGoalService,
                                RecurringObligationService recurringObligationService,
                                PriorityAlignmentService priorityAlignmentService) {
        this.budgetService = budgetService;
        this.savingsGoalService = savingsGoalService;
        this.recurringObligationService = recurringObligationService;
        this.priorityAlignmentService = priorityAlignmentService;
    }

    public MonthSummary summarize(YearMonth month, LocalDate today) {
        List<BudgetService.CategoryTotal> categoryTotals = budgetService.categoryTotals(month);
        long overBudgetCount = categoryTotals.stream().filter(BudgetService.CategoryTotal::isOverBudget).count();

        return new MonthSummary(
                categoryTotals,
                budgetService.totalIncome(month),
                budgetService.totalExpenses(month),
                budgetService.leftover(month),
                savingsGoalService.availableLeftover(month),
                overBudgetCount,
                savingsGoalService.goalProgress(),
                recurringObligationService.upcomingPayments(today));
    }

    public List<BudgetService.CategoryTotal> summarizeIdealizedPriorityList(YearMonth month) {
        return priorityAlignmentService.idealizedPriorityList(month);
    }

    public List<BudgetService.CategoryTotal> summarizeActualSpendList(YearMonth month) {
        return priorityAlignmentService.actualSpendList(month);
    }

    /**
     * Rolls up January through the given month, for that month's year.
     * Independent of savings goals/recurring obligations, since those
     * aren't month-scoped.
     */
    public YearToDateSummary summarizeYearToDate(YearMonth month) {
        YearMonth from = YearMonth.of(month.getYear(), 1);
        List<BudgetService.YtdCategoryTotal> categoryTotals = budgetService.categoryTotalsYearToDate(month);
        long overBudgetCount = categoryTotals.stream().filter(BudgetService.YtdCategoryTotal::isOverBudget).count();

        return new YearToDateSummary(
                month.getYear(),
                month,
                month.getMonthValue(),
                categoryTotals,
                budgetService.totalIncome(from, month),
                budgetService.totalExpenses(from, month),
                budgetService.leftover(from, month),
                overBudgetCount);
    }

    public static class MonthSummary {
        private final List<BudgetService.CategoryTotal> categoryTotals;
        private final BigDecimal totalIncome;
        private final BigDecimal totalExpenses;
        private final BigDecimal leftover;
        private final BigDecimal availableLeftover;
        private final long overBudgetCount;
        private final List<SavingsGoalService.GoalProgress> goalProgress;
        private final List<RecurringObligationService.UpcomingPayment> upcomingPayments;

        public MonthSummary(List<BudgetService.CategoryTotal> categoryTotals, BigDecimal totalIncome,
                             BigDecimal totalExpenses, BigDecimal leftover, BigDecimal availableLeftover,
                             long overBudgetCount, List<SavingsGoalService.GoalProgress> goalProgress,
                             List<RecurringObligationService.UpcomingPayment> upcomingPayments) {
            this.categoryTotals = categoryTotals;
            this.totalIncome = totalIncome;
            this.totalExpenses = totalExpenses;
            this.leftover = leftover;
            this.availableLeftover = availableLeftover;
            this.overBudgetCount = overBudgetCount;
            this.goalProgress = goalProgress;
            this.upcomingPayments = upcomingPayments;
        }

        public List<BudgetService.CategoryTotal> getCategoryTotals() {
            return categoryTotals;
        }

        public BigDecimal getTotalIncome() {
            return totalIncome;
        }

        public BigDecimal getTotalExpenses() {
            return totalExpenses;
        }

        public BigDecimal getLeftover() {
            return leftover;
        }

        public BigDecimal getAvailableLeftover() {
            return availableLeftover;
        }

        public long getOverBudgetCount() {
            return overBudgetCount;
        }

        public List<SavingsGoalService.GoalProgress> getGoalProgress() {
            return goalProgress;
        }

        public List<RecurringObligationService.UpcomingPayment> getUpcomingPayments() {
            return upcomingPayments;
        }
    }

    public static class YearToDateSummary {
        private final int year;
        private final YearMonth throughMonth;
        private final int monthsElapsed;
        private final List<BudgetService.YtdCategoryTotal> categoryTotals;
        private final BigDecimal totalIncome;
        private final BigDecimal totalExpenses;
        private final BigDecimal leftover;
        private final long overBudgetCount;

        public YearToDateSummary(int year, YearMonth throughMonth, int monthsElapsed,
                                  List<BudgetService.YtdCategoryTotal> categoryTotals, BigDecimal totalIncome,
                                  BigDecimal totalExpenses, BigDecimal leftover, long overBudgetCount) {
            this.year = year;
            this.throughMonth = throughMonth;
            this.monthsElapsed = monthsElapsed;
            this.categoryTotals = categoryTotals;
            this.totalIncome = totalIncome;
            this.totalExpenses = totalExpenses;
            this.leftover = leftover;
            this.overBudgetCount = overBudgetCount;
        }

        public int getYear() {
            return year;
        }

        public YearMonth getThroughMonth() {
            return throughMonth;
        }

        public int getMonthsElapsed() {
            return monthsElapsed;
        }

        public List<BudgetService.YtdCategoryTotal> getCategoryTotals() {
            return categoryTotals;
        }

        public BigDecimal getTotalIncome() {
            return totalIncome;
        }

        public BigDecimal getTotalExpenses() {
            return totalExpenses;
        }

        public BigDecimal getLeftover() {
            return leftover;
        }

        public long getOverBudgetCount() {
            return overBudgetCount;
        }
    }
}
