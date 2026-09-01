package com.example.finance;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.math.BigDecimal;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class MonthSummaryServiceTest {

    @Test
    void assemblesTotalsFromTheOtherServices(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        RecurringObligationRepository recurringObligationRepository = new RecurringObligationRepository(dataPaths);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        GoalContributionRepository goalContributionRepository = new GoalContributionRepository(dataPaths);
        RecurringObligationService recurringObligationService = new RecurringObligationService(
                recurringObligationRepository, transactionRepository, categoryRepository);
        BudgetService budgetService = new BudgetService(
                categoryRepository, transactionRepository, savingsGoalRepository, recurringObligationRepository);
        SavingsGoalService savingsGoalService = new SavingsGoalService(
                savingsGoalRepository, goalContributionRepository, budgetService, categoryRepository);
        MonthSummaryService monthSummaryService = new MonthSummaryService(
                budgetService, savingsGoalService, recurringObligationService, new PriorityAlignmentService(budgetService));

        YearMonth august = YearMonth.of(2026, 8);
        categoryRepository.add(new Category("Groceries", new BigDecimal("400.00")));
        categoryRepository.add(new Category("Subscriptions", new BigDecimal("20.00")));
        transactionRepository.add(LocalDate.of(2026, 8, 1), TransactionType.INCOME, "Salary",
                new BigDecimal("3000.00"), "paycheck");
        transactionRepository.add(LocalDate.of(2026, 8, 5), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("450.00"), "over target");
        recurringObligationRepository.add(new RecurringObligation("Streaming", "Subscriptions",
                new BigDecimal("120.00"), 12, LocalDate.of(2026, 8, 20), null, null));
        savingsGoalRepository.add(new SavingsGoal("Emergency fund", new BigDecimal("1000.00"), null, "Emergency fund"));
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

    private MonthSummaryService buildMonthSummaryService(Path tempDir, CategoryRepository categoryRepository,
                                                           TransactionRepository transactionRepository) {
        DataPaths dataPaths = new DataPaths(tempDir);
        RecurringObligationRepository recurringObligationRepository = new RecurringObligationRepository(dataPaths);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        GoalContributionRepository goalContributionRepository = new GoalContributionRepository(dataPaths);
        RecurringObligationService recurringObligationService = new RecurringObligationService(
                recurringObligationRepository, transactionRepository, categoryRepository);
        BudgetService budgetService = new BudgetService(
                categoryRepository, transactionRepository, savingsGoalRepository, recurringObligationRepository);
        SavingsGoalService savingsGoalService = new SavingsGoalService(
                savingsGoalRepository, goalContributionRepository, budgetService, categoryRepository);
        return new MonthSummaryService(
                budgetService, savingsGoalService, recurringObligationService, new PriorityAlignmentService(budgetService));
    }

    @Test
    void summarizeYearToDateAggregatesAcrossMonthsInTheSameYear(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        MonthSummaryService monthSummaryService =
                buildMonthSummaryService(tempDir, categoryRepository, transactionRepository);

        transactionRepository.add(LocalDate.of(2025, 12, 20), TransactionType.INCOME, "Salary",
                new BigDecimal("3000.00"), "prior year");
        transactionRepository.add(LocalDate.of(2026, 1, 1), TransactionType.INCOME, "Salary",
                new BigDecimal("3000.00"), "january");
        transactionRepository.add(LocalDate.of(2026, 2, 5), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("100.00"), "february");
        transactionRepository.add(LocalDate.of(2026, 8, 5), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("200.00"), "august");
        transactionRepository.add(LocalDate.of(2026, 9, 1), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("999.00"), "after selected month");

        MonthSummaryService.YearToDateSummary ytd = monthSummaryService.summarizeYearToDate(YearMonth.of(2026, 8));

        assertEquals(new BigDecimal("3000.00"), ytd.getTotalIncome());
        assertEquals(new BigDecimal("300.00"), ytd.getTotalExpenses());
        assertEquals(new BigDecimal("2700.00"), ytd.getLeftover());
    }

    @Test
    void summarizeYearToDateOverBudgetCountReflectsScaledTarget(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        MonthSummaryService monthSummaryService =
                buildMonthSummaryService(tempDir, categoryRepository, transactionRepository);

        categoryRepository.add(new Category("Groceries", new BigDecimal("100.00")));
        categoryRepository.add(new Category("Dining", new BigDecimal("50.00")));

        // Groceries: over the monthly target each month, but under the 3-month scaled target.
        transactionRepository.add(LocalDate.of(2026, 1, 1), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("120.00"), "january");
        transactionRepository.add(LocalDate.of(2026, 2, 1), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("120.00"), "february");
        transactionRepository.add(LocalDate.of(2026, 3, 1), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("50.00"), "march");

        // Dining: over its 3-month scaled target (150.00) even though no single month is a huge outlier.
        transactionRepository.add(LocalDate.of(2026, 1, 1), TransactionType.EXPENSE, "Dining",
                new BigDecimal("60.00"), "january");
        transactionRepository.add(LocalDate.of(2026, 2, 1), TransactionType.EXPENSE, "Dining",
                new BigDecimal("60.00"), "february");
        transactionRepository.add(LocalDate.of(2026, 3, 1), TransactionType.EXPENSE, "Dining",
                new BigDecimal("60.00"), "march");

        MonthSummaryService.YearToDateSummary ytd = monthSummaryService.summarizeYearToDate(YearMonth.of(2026, 3));

        assertEquals(1, ytd.getOverBudgetCount());
    }

    @Test
    void summarizeYearToDateInJanuaryMatchesSingleMonthSummary(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        MonthSummaryService monthSummaryService =
                buildMonthSummaryService(tempDir, categoryRepository, transactionRepository);

        categoryRepository.add(new Category("Groceries", new BigDecimal("100.00")));
        transactionRepository.add(LocalDate.of(2026, 1, 1), TransactionType.INCOME, "Salary",
                new BigDecimal("3000.00"), "january income");
        transactionRepository.add(LocalDate.of(2026, 1, 5), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("80.00"), "january expense");

        YearMonth january = YearMonth.of(2026, 1);
        MonthSummaryService.MonthSummary monthSummary = monthSummaryService.summarize(january, LocalDate.of(2026, 1, 15));
        MonthSummaryService.YearToDateSummary ytd = monthSummaryService.summarizeYearToDate(january);

        assertEquals(monthSummary.getTotalIncome(), ytd.getTotalIncome());
        assertEquals(monthSummary.getTotalExpenses(), ytd.getTotalExpenses());
        assertEquals(monthSummary.getLeftover(), ytd.getLeftover());
        assertEquals(monthSummary.getCategoryTotals().get(0).getActual(), ytd.getCategoryTotals().get(0).getActual());
        assertEquals(monthSummary.getCategoryTotals().get(0).getCategory().getMonthlyTarget(),
                ytd.getCategoryTotals().get(0).getScaledTarget());
    }

    @Test
    void summarizeIdealizedAndActualSpendListsReflectDifferentOrderings(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        MonthSummaryService monthSummaryService =
                buildMonthSummaryService(tempDir, categoryRepository, transactionRepository);

        categoryRepository.add(new Category("Rent", new BigDecimal("800.00"), 1));
        categoryRepository.add(new Category("Entertainment", new BigDecimal("200.00"), 2));

        YearMonth august = YearMonth.of(2026, 8);
        transactionRepository.add(LocalDate.of(2026, 8, 1), TransactionType.EXPENSE, "Rent",
                new BigDecimal("800.00"), "august rent");
        transactionRepository.add(LocalDate.of(2026, 8, 5), TransactionType.EXPENSE, "Entertainment",
                new BigDecimal("900.00"), "overspent on fun");

        List<BudgetService.CategoryTotal> idealized = monthSummaryService.summarizeIdealizedPriorityList(august);
        List<BudgetService.CategoryTotal> actualSpend = monthSummaryService.summarizeActualSpendList(august);

        assertEquals("Rent", idealized.get(0).getCategory().getName());
        assertEquals("Entertainment", idealized.get(1).getCategory().getName());

        assertEquals("Entertainment", actualSpend.get(0).getCategory().getName());
        assertEquals("Rent", actualSpend.get(1).getCategory().getName());
    }
}
