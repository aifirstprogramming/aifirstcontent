package com.example.finance;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.math.BigDecimal;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BudgetServiceTest {

    @Test
    void sumsCategoryTotalsAndLeftoverForTheGivenMonth(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        RecurringObligationRepository recurringObligationRepository = new RecurringObligationRepository(dataPaths);
        categoryRepository.add(new Category("Groceries", new BigDecimal("400.00")));
        BudgetService budgetService = new BudgetService(
                categoryRepository, transactionRepository, savingsGoalRepository, recurringObligationRepository);

        YearMonth august = YearMonth.of(2026, 8);
        transactionRepository.add(LocalDate.of(2026, 8, 1), TransactionType.INCOME, "Salary",
                new BigDecimal("3000.00"), "paycheck");
        transactionRepository.add(LocalDate.of(2026, 8, 5), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("120.00"), "shop 1");
        transactionRepository.add(LocalDate.of(2026, 8, 12), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("80.00"), "shop 2");
        // different month, should be excluded
        transactionRepository.add(LocalDate.of(2026, 9, 1), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("999.00"), "next month");

        List<BudgetService.CategoryTotal> totals = budgetService.categoryTotals(august);
        assertEquals(1, totals.size());
        assertEquals(new BigDecimal("200.00"), totals.get(0).getActual());

        assertEquals(new BigDecimal("3000.00"), budgetService.totalIncome(august));
        assertEquals(new BigDecimal("200.00"), budgetService.totalExpenses(august));
        assertEquals(new BigDecimal("2800.00"), budgetService.leftover(august));
    }

    @Test
    void categoryActualIncludesIncomeTransactionsNotJustExpenses(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        RecurringObligationRepository recurringObligationRepository = new RecurringObligationRepository(dataPaths);
        categoryRepository.add(new Category("Paycheck", new BigDecimal("1000.00")));
        BudgetService budgetService = new BudgetService(
                categoryRepository, transactionRepository, savingsGoalRepository, recurringObligationRepository);

        YearMonth august = YearMonth.of(2026, 8);
        transactionRepository.add(LocalDate.of(2026, 8, 1), TransactionType.INCOME, "Paycheck",
                new BigDecimal("1000.00"), "August paycheck");

        List<BudgetService.CategoryTotal> totals = budgetService.categoryTotals(august);
        assertEquals(1, totals.size());
        assertEquals(new BigDecimal("1000.00"), totals.get(0).getActual());
        assertTrue(totals.get(0).isIncomeOnly());
    }

    @Test
    void categoryIsNotIncomeOnlyWhenItHasAnyExpenseTransaction(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        RecurringObligationRepository recurringObligationRepository = new RecurringObligationRepository(dataPaths);
        categoryRepository.add(new Category("Groceries", new BigDecimal("400.00")));
        BudgetService budgetService = new BudgetService(
                categoryRepository, transactionRepository, savingsGoalRepository, recurringObligationRepository);

        transactionRepository.add(LocalDate.of(2026, 8, 5), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("120.00"), "shop 1");

        List<BudgetService.CategoryTotal> totals = budgetService.categoryTotals(YearMonth.of(2026, 8));
        assertFalse(totals.get(0).isIncomeOnly());
    }

    @Test
    void isNotOverBudgetWhenActualExactlyMatchesTarget() {
        BudgetService.CategoryTotal total = new BudgetService.CategoryTotal(
                new Category("Groceries", new BigDecimal("400.00")), new BigDecimal("400.00"));
        assertFalse(total.isOverBudget());
    }

    @Test
    void isOverBudgetWhenActualExceedsTarget() {
        BudgetService.CategoryTotal total = new BudgetService.CategoryTotal(
                new Category("Groceries", new BigDecimal("400.00")), new BigDecimal("400.01"));
        assertTrue(total.isOverBudget());
    }

    @Test
    void totalsAcrossMultiMonthRangeSumOnlyMonthsWithinRange(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        RecurringObligationRepository recurringObligationRepository = new RecurringObligationRepository(dataPaths);
        BudgetService budgetService = new BudgetService(
                categoryRepository, transactionRepository, savingsGoalRepository, recurringObligationRepository);

        transactionRepository.add(LocalDate.of(2025, 12, 15), TransactionType.INCOME, "Salary",
                new BigDecimal("500.00"), "before range");
        transactionRepository.add(LocalDate.of(2026, 1, 1), TransactionType.INCOME, "Salary",
                new BigDecimal("1000.00"), "january");
        transactionRepository.add(LocalDate.of(2026, 2, 1), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("100.00"), "february");
        transactionRepository.add(LocalDate.of(2026, 3, 1), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("50.00"), "march");
        transactionRepository.add(LocalDate.of(2026, 4, 1), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("999.00"), "after range");

        YearMonth from = YearMonth.of(2026, 1);
        YearMonth to = YearMonth.of(2026, 3);
        assertEquals(new BigDecimal("1000.00"), budgetService.totalIncome(from, to));
        assertEquals(new BigDecimal("150.00"), budgetService.totalExpenses(from, to));
        assertEquals(new BigDecimal("850.00"), budgetService.leftover(from, to));
    }

    @Test
    void singleMonthRangeCallMatchesOriginalSingleMonthBehavior(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        RecurringObligationRepository recurringObligationRepository = new RecurringObligationRepository(dataPaths);
        BudgetService budgetService = new BudgetService(
                categoryRepository, transactionRepository, savingsGoalRepository, recurringObligationRepository);

        YearMonth august = YearMonth.of(2026, 8);
        transactionRepository.add(LocalDate.of(2026, 8, 1), TransactionType.INCOME, "Salary",
                new BigDecimal("3000.00"), "paycheck");
        transactionRepository.add(LocalDate.of(2026, 8, 5), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("120.00"), "shop 1");

        assertEquals(budgetService.totalIncome(august), budgetService.totalIncome(august, august));
        assertEquals(budgetService.totalExpenses(august), budgetService.totalExpenses(august, august));
        assertEquals(budgetService.leftover(august), budgetService.leftover(august, august));
    }

    @Test
    void categoryTotalsYearToDateScalesMonthlyTargetByMonthsElapsed(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        RecurringObligationRepository recurringObligationRepository = new RecurringObligationRepository(dataPaths);
        categoryRepository.add(new Category("Groceries", new BigDecimal("100.00")));
        BudgetService budgetService = new BudgetService(
                categoryRepository, transactionRepository, savingsGoalRepository, recurringObligationRepository);

        transactionRepository.add(LocalDate.of(2026, 1, 1), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("90.00"), "january");
        transactionRepository.add(LocalDate.of(2026, 2, 1), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("90.00"), "february");
        transactionRepository.add(LocalDate.of(2026, 3, 1), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("90.00"), "march");

        List<BudgetService.YtdCategoryTotal> totals = budgetService.categoryTotalsYearToDate(YearMonth.of(2026, 3));
        assertEquals(1, totals.size());
        assertEquals(new BigDecimal("300.00"), totals.get(0).getScaledTarget());
        assertEquals(new BigDecimal("270.00"), totals.get(0).getActual());
    }

    @Test
    void categoryTotalsYearToDateOverBudgetBoundary() {
        Category category = new Category("Groceries", new BigDecimal("100.00"));
        BudgetService.YtdCategoryTotal exactMatch = new BudgetService.YtdCategoryTotal(
                category, new BigDecimal("300.00"), new BigDecimal("300.00"), false);
        assertFalse(exactMatch.isOverBudget());

        BudgetService.YtdCategoryTotal overBudget = new BudgetService.YtdCategoryTotal(
                category, new BigDecimal("300.01"), new BigDecimal("300.00"), false);
        assertTrue(overBudget.isOverBudget());
    }

    @Test
    void categoryTotalsYearToDateInJanuaryEqualsSingleMonthTotals(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        RecurringObligationRepository recurringObligationRepository = new RecurringObligationRepository(dataPaths);
        categoryRepository.add(new Category("Groceries", new BigDecimal("100.00")));
        BudgetService budgetService = new BudgetService(
                categoryRepository, transactionRepository, savingsGoalRepository, recurringObligationRepository);

        transactionRepository.add(LocalDate.of(2026, 1, 5), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("80.00"), "january");

        YearMonth january = YearMonth.of(2026, 1);
        List<BudgetService.CategoryTotal> monthly = budgetService.categoryTotals(january);
        List<BudgetService.YtdCategoryTotal> ytd = budgetService.categoryTotalsYearToDate(january);

        assertEquals(monthly.get(0).getActual(), ytd.get(0).getActual());
        assertEquals(monthly.get(0).getCategory().getMonthlyTarget(), ytd.get(0).getScaledTarget());
    }

    @Test
    void categoryTotalsYearToDateExcludesPriorYearTransactions(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        RecurringObligationRepository recurringObligationRepository = new RecurringObligationRepository(dataPaths);
        categoryRepository.add(new Category("Groceries", new BigDecimal("100.00")));
        BudgetService budgetService = new BudgetService(
                categoryRepository, transactionRepository, savingsGoalRepository, recurringObligationRepository);

        transactionRepository.add(LocalDate.of(2025, 12, 15), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("999.00"), "prior year");
        transactionRepository.add(LocalDate.of(2026, 2, 1), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("50.00"), "february");

        List<BudgetService.YtdCategoryTotal> totals = budgetService.categoryTotalsYearToDate(YearMonth.of(2026, 3));
        assertEquals(new BigDecimal("50.00"), totals.get(0).getActual());
    }

    @Test
    void categoryActualIncludesTransactionsTaggedDirectlyToAGoalAssignedToThatCategory(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        RecurringObligationRepository recurringObligationRepository = new RecurringObligationRepository(dataPaths);
        categoryRepository.add(new Category("Savings", new BigDecimal("200.00")));
        savingsGoalRepository.add(new SavingsGoal("Emergency fund", new BigDecimal("1000.00"), null, "Savings"));
        BudgetService budgetService = new BudgetService(
                categoryRepository, transactionRepository, savingsGoalRepository, recurringObligationRepository);

        transactionRepository.add(LocalDate.of(2026, 8, 1), TransactionType.EXPENSE, "Emergency fund",
                new BigDecimal("50.00"), "ad-hoc transfer");

        List<BudgetService.CategoryTotal> totals = budgetService.categoryTotals(YearMonth.of(2026, 8));
        assertEquals(new BigDecimal("50.00"), totals.get(0).getActual());
    }

    @Test
    void categoryActualIncludesTransactionsTaggedDirectlyToAnObligationAssignedToThatCategory(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        RecurringObligationRepository recurringObligationRepository = new RecurringObligationRepository(dataPaths);
        categoryRepository.add(new Category("Loans", new BigDecimal("500.00")));
        recurringObligationRepository.add(new RecurringObligation("Car loan", "Loans", new BigDecimal("450.00"),
                1, LocalDate.of(2026, 1, 1), null, null));
        BudgetService budgetService = new BudgetService(
                categoryRepository, transactionRepository, savingsGoalRepository, recurringObligationRepository);

        transactionRepository.add(LocalDate.of(2026, 8, 1), TransactionType.EXPENSE, "Car loan",
                new BigDecimal("450.00"), "August payment");

        List<BudgetService.CategoryTotal> totals = budgetService.categoryTotals(YearMonth.of(2026, 8));
        assertEquals(new BigDecimal("450.00"), totals.get(0).getActual());
    }

    @Test
    void orphanedCategoryNameOnATransactionIsExcludedFromAnyCategorysActualButStillCountsTowardExpenses(
            @TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        RecurringObligationRepository recurringObligationRepository = new RecurringObligationRepository(dataPaths);
        categoryRepository.add(new Category("Groceries", new BigDecimal("400.00")));
        BudgetService budgetService = new BudgetService(
                categoryRepository, transactionRepository, savingsGoalRepository, recurringObligationRepository);

        transactionRepository.add(LocalDate.of(2026, 8, 1), TransactionType.EXPENSE, "Typo'd category",
                new BigDecimal("25.00"), "mistake");

        List<BudgetService.CategoryTotal> totals = budgetService.categoryTotals(YearMonth.of(2026, 8));
        assertEquals(new BigDecimal("0.00"), totals.get(0).getActual().setScale(2));
        assertEquals(new BigDecimal("25.00"), budgetService.totalExpenses(YearMonth.of(2026, 8)));
    }
}
