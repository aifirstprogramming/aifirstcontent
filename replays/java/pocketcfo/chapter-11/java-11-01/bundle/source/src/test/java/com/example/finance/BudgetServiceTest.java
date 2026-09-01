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
        categoryRepository.add(new Category("Groceries", new BigDecimal("400.00")));
        BudgetService budgetService = new BudgetService(categoryRepository, transactionRepository);

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
}
