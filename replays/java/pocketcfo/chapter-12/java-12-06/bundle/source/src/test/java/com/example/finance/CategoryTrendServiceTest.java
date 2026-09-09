package com.example.finance;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.math.BigDecimal;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CategoryTrendServiceTest {

    private CategoryTrendService newService(CategoryRepository categoryRepository,
                                              TransactionRepository transactionRepository,
                                              SavingsGoalRepository savingsGoalRepository,
                                              RecurringObligationRepository recurringObligationRepository) {
        BudgetService budgetService = new BudgetService(
                categoryRepository, transactionRepository, savingsGoalRepository, recurringObligationRepository);
        return new CategoryTrendService(budgetService);
    }

    @Test
    void trendsThroughMonthComputesTheThreeMonthsInOrder(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        RecurringObligationRepository recurringObligationRepository = new RecurringObligationRepository(dataPaths);
        categoryRepository.add(new Category("Groceries", new BigDecimal("300.00")));
        CategoryTrendService service = newService(
                categoryRepository, transactionRepository, savingsGoalRepository, recurringObligationRepository);

        transactionRepository.add(LocalDate.of(2026, 6, 5), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("310.00"), "june");
        transactionRepository.add(LocalDate.of(2026, 7, 5), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("340.00"), "july");
        transactionRepository.add(LocalDate.of(2026, 8, 5), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("290.00"), "august");

        List<CategoryTrendService.CategoryTrend> trends = service.trendsThroughMonth(YearMonth.of(2026, 8));

        assertEquals(1, trends.size());
        List<CategoryTrendService.MonthAmount> amounts = trends.get(0).getMonthAmounts();
        assertEquals(3, amounts.size());
        assertEquals(YearMonth.of(2026, 6), amounts.get(0).month());
        assertEquals(new BigDecimal("310.00"), amounts.get(0).amount());
        assertEquals(YearMonth.of(2026, 7), amounts.get(1).month());
        assertEquals(new BigDecimal("340.00"), amounts.get(1).amount());
        assertEquals(YearMonth.of(2026, 8), amounts.get(2).month());
        assertEquals(new BigDecimal("290.00"), amounts.get(2).amount());
    }

    @Test
    void aMonthWithNoTransactionsDefaultsToZeroRatherThanBeingOmitted(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        RecurringObligationRepository recurringObligationRepository = new RecurringObligationRepository(dataPaths);
        categoryRepository.add(new Category("Travel", new BigDecimal("50.00")));
        CategoryTrendService service = newService(
                categoryRepository, transactionRepository, savingsGoalRepository, recurringObligationRepository);

        // Only August has a transaction; June and July should still appear, at zero.
        transactionRepository.add(LocalDate.of(2026, 8, 10), TransactionType.EXPENSE, "Travel",
                new BigDecimal("120.00"), "flight");

        List<CategoryTrendService.CategoryTrend> trends = service.trendsThroughMonth(YearMonth.of(2026, 8));

        List<CategoryTrendService.MonthAmount> amounts = trends.get(0).getMonthAmounts();
        assertEquals(new BigDecimal("0.00").setScale(2), amounts.get(0).amount().setScale(2));
        assertEquals(new BigDecimal("0.00").setScale(2), amounts.get(1).amount().setScale(2));
        assertEquals(new BigDecimal("120.00"), amounts.get(2).amount());
    }

    @Test
    void incomeOnlyCategoriesAreExcluded(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        RecurringObligationRepository recurringObligationRepository = new RecurringObligationRepository(dataPaths);
        categoryRepository.add(new Category("Paycheck", new BigDecimal("1000.00")));
        CategoryTrendService service = newService(
                categoryRepository, transactionRepository, savingsGoalRepository, recurringObligationRepository);

        transactionRepository.add(LocalDate.of(2026, 8, 1), TransactionType.INCOME, "Paycheck",
                new BigDecimal("1000.00"), "august paycheck");

        List<CategoryTrendService.CategoryTrend> trends = service.trendsThroughMonth(YearMonth.of(2026, 8));

        assertTrue(trends.isEmpty());
    }

    @Test
    void windowCrossingAYearBoundaryResolvesThePriorYearsMonths(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        RecurringObligationRepository recurringObligationRepository = new RecurringObligationRepository(dataPaths);
        categoryRepository.add(new Category("Groceries", new BigDecimal("300.00")));
        CategoryTrendService service = newService(
                categoryRepository, transactionRepository, savingsGoalRepository, recurringObligationRepository);

        transactionRepository.add(LocalDate.of(2025, 11, 5), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("100.00"), "november");
        transactionRepository.add(LocalDate.of(2025, 12, 5), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("200.00"), "december");
        transactionRepository.add(LocalDate.of(2026, 1, 5), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("150.00"), "january");

        List<CategoryTrendService.CategoryTrend> trends = service.trendsThroughMonth(YearMonth.of(2026, 1));

        List<CategoryTrendService.MonthAmount> amounts = trends.get(0).getMonthAmounts();
        assertEquals(YearMonth.of(2025, 11), amounts.get(0).month());
        assertEquals(YearMonth.of(2025, 12), amounts.get(1).month());
        assertEquals(YearMonth.of(2026, 1), amounts.get(2).month());
        assertEquals(new BigDecimal("100.00"), amounts.get(0).amount());
        assertEquals(new BigDecimal("200.00"), amounts.get(1).amount());
        assertEquals(new BigDecimal("150.00"), amounts.get(2).amount());
    }
}
