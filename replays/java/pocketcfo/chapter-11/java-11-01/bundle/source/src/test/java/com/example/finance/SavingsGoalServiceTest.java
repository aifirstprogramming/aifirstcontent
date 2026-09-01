package com.example.finance;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.math.BigDecimal;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.YearMonth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class SavingsGoalServiceTest {

    private record Fixture(SavingsGoalService service, TransactionRepository transactionRepository,
                            SavingsGoalRepository savingsGoalRepository) {
    }

    private Fixture newFixture(Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        BudgetService budgetService = new BudgetService(categoryRepository, transactionRepository);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        GoalContributionRepository goalContributionRepository = new GoalContributionRepository(dataPaths);
        SavingsGoalService service = new SavingsGoalService(
                savingsGoalRepository, goalContributionRepository, budgetService);
        return new Fixture(service, transactionRepository, savingsGoalRepository);
    }

    @Test
    void allocationReducesAvailableLeftoverAndIncreasesGoalProgress(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        YearMonth august = YearMonth.of(2026, 8);
        fixture.transactionRepository().add(LocalDate.of(2026, 8, 1), TransactionType.INCOME, "Salary",
                new BigDecimal("1000.00"), "paycheck");
        fixture.savingsGoalRepository().add(new SavingsGoal("Emergency fund", new BigDecimal("500.00"), null));

        assertEquals(new BigDecimal("1000.00"), fixture.service().availableLeftover(august));

        fixture.service().allocateLeftoverToGoal("Emergency fund", new BigDecimal("300.00"), august);

        assertEquals(new BigDecimal("700.00"), fixture.service().availableLeftover(august));
        assertEquals(new BigDecimal("300.00"), fixture.service().totalSaved("Emergency fund"));
    }

    @Test
    void rejectsAllocationThatExceedsAvailableLeftover(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        YearMonth august = YearMonth.of(2026, 8);
        fixture.transactionRepository().add(LocalDate.of(2026, 8, 1), TransactionType.INCOME, "Salary",
                new BigDecimal("100.00"), "paycheck");
        fixture.savingsGoalRepository().add(new SavingsGoal("Emergency fund", new BigDecimal("500.00"), null));

        assertThrows(IllegalArgumentException.class, () ->
                fixture.service().allocateLeftoverToGoal("Emergency fund", new BigDecimal("100.01"), august));
    }

    @Test
    void rejectsNonPositiveAllocation(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        YearMonth august = YearMonth.of(2026, 8);

        assertThrows(IllegalArgumentException.class, () ->
                fixture.service().allocateLeftoverToGoal("Emergency fund", BigDecimal.ZERO, august));
    }
}
