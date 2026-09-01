package com.example.finance;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.math.BigDecimal;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.YearMonth;

import static org.junit.jupiter.api.Assertions.assertEquals;

class MonthSummaryServiceTest {

    @Test
    void assemblesTotalsFromTheOtherServices(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        RecurringObligationRepository recurringObligationRepository = new RecurringObligationRepository(dataPaths);
        RecurringObligationService recurringObligationService = new RecurringObligationService(recurringObligationRepository);
        BudgetService budgetService = new BudgetService(categoryRepository, transactionRepository, recurringObligationService);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        GoalContributionRepository goalContributionRepository = new GoalContributionRepository(dataPaths);
        SavingsGoalService savingsGoalService = new SavingsGoalService(
                savingsGoalRepository, goalContributionRepository, budgetService);
        MonthSummaryService monthSummaryService = new MonthSummaryService(
                budgetService, savingsGoalService, recurringObligationService);

        YearMonth august = YearMonth.of(2026, 8);
        categoryRepository.add(new Category("Groceries", new BigDecimal("400.00")));
        categoryRepository.add(new Category("Subscriptions", new BigDecimal("20.00")));
        transactionRepository.add(LocalDate.of(2026, 8, 1), TransactionType.INCOME, "Salary",
                new BigDecimal("3000.00"), "paycheck");
        transactionRepository.add(LocalDate.of(2026, 8, 5), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("450.00"), "over target");
        recurringObligationRepository.add(new RecurringObligation("Streaming", "Subscriptions",
                new BigDecimal("120.00"), 12, LocalDate.of(2026, 8, 20), null, null));
        savingsGoalRepository.add(new SavingsGoal("Emergency fund", new BigDecimal("1000.00"), null));
        savingsGoalService.allocateLeftoverToGoal("Emergency fund", new BigDecimal("500.00"), august);

        MonthSummaryService.MonthSummary summary = monthSummaryService.summarize(august, LocalDate.of(2026, 8, 14));

        assertEquals(new BigDecimal("3000.00"), summary.getTotalIncome());
        assertEquals(new BigDecimal("450.00"), summary.getTotalExpenses());
        assertEquals(new BigDecimal("2550.00"), summary.getLeftover());
        assertEquals(new BigDecimal("2050.00"), summary.getAvailableLeftover());
        assertEquals(1, summary.getOverBudgetCount());
        assertEquals(1, summary.getGoalProgress().size());
        assertEquals(new BigDecimal("500.00"), summary.getGoalProgress().get(0).getSavedAmount());
        assertEquals(1, summary.getUpcomingPayments().size());
    }
}
