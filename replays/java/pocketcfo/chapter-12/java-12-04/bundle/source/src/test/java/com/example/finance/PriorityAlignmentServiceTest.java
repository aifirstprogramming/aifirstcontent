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

class PriorityAlignmentServiceTest {

    private PriorityAlignmentService newService(CategoryRepository categoryRepository,
                                                  TransactionRepository transactionRepository,
                                                  SavingsGoalRepository savingsGoalRepository,
                                                  RecurringObligationRepository recurringObligationRepository) {
        BudgetService budgetService = new BudgetService(
                categoryRepository, transactionRepository, savingsGoalRepository, recurringObligationRepository);
        return new PriorityAlignmentService(budgetService);
    }

    @Test
    void idealizedPriorityListIsSortedByPriorityAscendingAndExcludesUnprioritizedCategories(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        RecurringObligationRepository recurringObligationRepository = new RecurringObligationRepository(dataPaths);
        categoryRepository.add(new Category("Groceries", new BigDecimal("300.00"), 2));
        categoryRepository.add(new Category("Rent", new BigDecimal("800.00"), 1));
        categoryRepository.add(new Category("Miscellaneous", new BigDecimal("50.00")));
        PriorityAlignmentService service = newService(
                categoryRepository, transactionRepository, savingsGoalRepository, recurringObligationRepository);

        List<BudgetService.CategoryTotal> idealized = service.idealizedPriorityList(YearMonth.of(2026, 8));

        assertEquals(2, idealized.size());
        assertEquals("Rent", idealized.get(0).getCategory().getName());
        assertEquals("Groceries", idealized.get(1).getCategory().getName());
    }

    @Test
    void actualSpendListIsSortedByActualSpendDescendingAndIncludesUnprioritizedCategories(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        RecurringObligationRepository recurringObligationRepository = new RecurringObligationRepository(dataPaths);
        categoryRepository.add(new Category("Education", new BigDecimal("50.00"), 1));
        categoryRepository.add(new Category("Groceries", new BigDecimal("300.00")));
        categoryRepository.add(new Category("Rent", new BigDecimal("800.00")));
        PriorityAlignmentService service = newService(
                categoryRepository, transactionRepository, savingsGoalRepository, recurringObligationRepository);

        YearMonth august = YearMonth.of(2026, 8);
        // Education is priority #1, but two unprioritized categories both
        // outspend it, so it should fall to #3 in the actual-spend list.
        transactionRepository.add(LocalDate.of(2026, 8, 1), TransactionType.EXPENSE, "Education",
                new BigDecimal("10.00"), "textbook");
        transactionRepository.add(LocalDate.of(2026, 8, 2), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("300.00"), "groceries");
        transactionRepository.add(LocalDate.of(2026, 8, 3), TransactionType.EXPENSE, "Rent",
                new BigDecimal("800.00"), "rent");

        List<BudgetService.CategoryTotal> actualSpend = service.actualSpendList(august);

        assertEquals(3, actualSpend.size());
        assertEquals("Rent", actualSpend.get(0).getCategory().getName());
        assertEquals("Groceries", actualSpend.get(1).getCategory().getName());
        assertEquals("Education", actualSpend.get(2).getCategory().getName());
    }

    @Test
    void incomeOnlyCategoriesAreExcludedFromBothLists(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        RecurringObligationRepository recurringObligationRepository = new RecurringObligationRepository(dataPaths);
        categoryRepository.add(new Category("Paycheck", new BigDecimal("1000.00"), 1));
        PriorityAlignmentService service = newService(
                categoryRepository, transactionRepository, savingsGoalRepository, recurringObligationRepository);

        transactionRepository.add(LocalDate.of(2026, 8, 1), TransactionType.INCOME, "Paycheck",
                new BigDecimal("1000.00"), "august paycheck");

        YearMonth august = YearMonth.of(2026, 8);
        assertTrue(service.idealizedPriorityList(august).isEmpty());
        assertTrue(service.actualSpendList(august).isEmpty());
    }

    @Test
    void tiesInPriorityOrSpendAreBrokenDeterministicallyByName(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        RecurringObligationRepository recurringObligationRepository = new RecurringObligationRepository(dataPaths);
        categoryRepository.add(new Category("Beta", new BigDecimal("100.00"), 1));
        categoryRepository.add(new Category("Alpha", new BigDecimal("100.00"), 1));
        PriorityAlignmentService service = newService(
                categoryRepository, transactionRepository, savingsGoalRepository, recurringObligationRepository);

        YearMonth august = YearMonth.of(2026, 8);
        transactionRepository.add(LocalDate.of(2026, 8, 1), TransactionType.EXPENSE, "Beta",
                new BigDecimal("50.00"), "beta spend");
        transactionRepository.add(LocalDate.of(2026, 8, 1), TransactionType.EXPENSE, "Alpha",
                new BigDecimal("50.00"), "alpha spend");

        List<BudgetService.CategoryTotal> idealized = service.idealizedPriorityList(august);
        List<BudgetService.CategoryTotal> actualSpend = service.actualSpendList(august);

        assertEquals("Alpha", idealized.get(0).getCategory().getName());
        assertEquals("Beta", idealized.get(1).getCategory().getName());
        assertEquals("Alpha", actualSpend.get(0).getCategory().getName());
        assertEquals("Beta", actualSpend.get(1).getCategory().getName());
    }
}
