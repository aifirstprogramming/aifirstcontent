package com.example.finance;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.math.BigDecimal;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.YearMonth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SavingsGoalServiceTest {

    private record Fixture(SavingsGoalService service, TransactionRepository transactionRepository,
                            SavingsGoalRepository savingsGoalRepository, CategoryRepository categoryRepository,
                            GoalContributionRepository goalContributionRepository) {
    }

    private Fixture newFixture(Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        RecurringObligationRepository recurringObligationRepository = new RecurringObligationRepository(dataPaths);
        BudgetService budgetService = new BudgetService(categoryRepository, transactionRepository);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        GoalContributionRepository goalContributionRepository = new GoalContributionRepository(dataPaths);
        CategoryService categoryService = new CategoryService(
                categoryRepository, transactionRepository, recurringObligationRepository, savingsGoalRepository);
        SavingsGoalService service = new SavingsGoalService(
                savingsGoalRepository, goalContributionRepository, budgetService, categoryRepository, categoryService);
        return new Fixture(service, transactionRepository, savingsGoalRepository, categoryRepository,
                goalContributionRepository);
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

    @Test
    void addGoalCreatesAMatchingCategoryWhenNoneExists(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);

        fixture.service().addGoal(new SavingsGoal("Emergency fund", new BigDecimal("500.00"), null));

        assertEquals(1, fixture.categoryRepository().findAll().size());
        assertEquals("Emergency fund", fixture.categoryRepository().findAll().get(0).getName());
    }

    @Test
    void addGoalDoesNotDuplicateAnExistingCategory(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        fixture.categoryRepository().add(new Category("Emergency fund", new BigDecimal("50.00")));

        fixture.service().addGoal(new SavingsGoal("Emergency fund", new BigDecimal("500.00"), null));

        assertEquals(1, fixture.categoryRepository().findAll().size());
        assertEquals(new BigDecimal("50.00"), fixture.categoryRepository().findAll().get(0).getMonthlyTarget());
    }

    @Test
    void updateGoalBackfillsAMissingCategoryEvenWithoutARename(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        fixture.savingsGoalRepository().add(new SavingsGoal("Vacation", new BigDecimal("2000.00"), null));

        fixture.service().updateGoal("Vacation", new SavingsGoal("Vacation", new BigDecimal("2500.00"), null));

        assertTrue(fixture.categoryRepository().findAll().stream().anyMatch(c -> c.getName().equals("Vacation")));
    }

    @Test
    void updateGoalRenameCascadesToContributionsAndMatchingCategory(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        fixture.service().addGoal(new SavingsGoal("Emergency fund", new BigDecimal("500.00"), null));
        fixture.goalContributionRepository().add(LocalDate.of(2026, 8, 1), "Emergency fund", new BigDecimal("100.00"));

        fixture.service().updateGoal("Emergency fund", new SavingsGoal("Rainy day fund", new BigDecimal("600.00"), null));

        assertEquals("Rainy day fund", fixture.savingsGoalRepository().findAll().get(0).getName());
        assertEquals(new BigDecimal("100.00"), fixture.service().totalSaved("Rainy day fund"));
        assertEquals(BigDecimal.ZERO.setScale(2), fixture.service().totalSaved("Emergency fund").setScale(2));
        assertTrue(fixture.categoryRepository().findAll().stream()
                .anyMatch(c -> c.getName().equals("Rainy day fund")));
        assertTrue(fixture.categoryRepository().findAll().stream()
                .noneMatch(c -> c.getName().equals("Emergency fund")));
    }

    @Test
    void deleteGoalRemovesAGoalWithNoSavings(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        fixture.service().addGoal(new SavingsGoal("Emergency fund", new BigDecimal("500.00"), null));

        fixture.service().deleteGoal("Emergency fund");

        assertEquals(0, fixture.savingsGoalRepository().findAll().size());
    }

    @Test
    void deleteGoalRejectsAGoalThatAlreadyHasSavings(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        fixture.service().addGoal(new SavingsGoal("Emergency fund", new BigDecimal("500.00"), null));
        fixture.goalContributionRepository().add(LocalDate.of(2026, 8, 1), "Emergency fund", new BigDecimal("100.00"));

        assertThrows(IllegalStateException.class, () -> fixture.service().deleteGoal("Emergency fund"));
        assertEquals(1, fixture.savingsGoalRepository().findAll().size());
    }

    @Test
    void updateContributionChangesTheAmountWithoutDoubleCountingItsOwnOldAmount(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        YearMonth august = YearMonth.of(2026, 8);
        fixture.transactionRepository().add(LocalDate.of(2026, 8, 1), TransactionType.INCOME, "Salary",
                new BigDecimal("1000.00"), "paycheck");
        fixture.service().addGoal(new SavingsGoal("Emergency fund", new BigDecimal("500.00"), null));
        GoalContribution contribution = fixture.goalContributionRepository()
                .add(LocalDate.of(2026, 8, 5), "Emergency fund", new BigDecimal("300.00"));

        fixture.service().updateContribution(contribution.getId(), LocalDate.of(2026, 8, 5),
                "Emergency fund", new BigDecimal("400.00"), august);

        assertEquals(new BigDecimal("400.00"), fixture.service().totalSaved("Emergency fund"));
        assertEquals(new BigDecimal("600.00"), fixture.service().availableLeftover(august));
    }

    @Test
    void updateContributionRejectsAnIncreaseThatExceedsAvailableLeftover(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        YearMonth august = YearMonth.of(2026, 8);
        fixture.transactionRepository().add(LocalDate.of(2026, 8, 1), TransactionType.INCOME, "Salary",
                new BigDecimal("1000.00"), "paycheck");
        fixture.service().addGoal(new SavingsGoal("Emergency fund", new BigDecimal("500.00"), null));
        GoalContribution contribution = fixture.goalContributionRepository()
                .add(LocalDate.of(2026, 8, 5), "Emergency fund", new BigDecimal("300.00"));

        assertThrows(IllegalArgumentException.class, () -> fixture.service().updateContribution(
                contribution.getId(), LocalDate.of(2026, 8, 5), "Emergency fund",
                new BigDecimal("1000.01"), august));
    }

    @Test
    void deleteContributionRemovesItAndReducesTotalSaved(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        fixture.service().addGoal(new SavingsGoal("Emergency fund", new BigDecimal("500.00"), null));
        GoalContribution contribution = fixture.goalContributionRepository()
                .add(LocalDate.of(2026, 8, 5), "Emergency fund", new BigDecimal("300.00"));

        fixture.service().deleteContribution(contribution.getId());

        assertEquals(BigDecimal.ZERO.setScale(2), fixture.service().totalSaved("Emergency fund").setScale(2));
        assertEquals(0, fixture.goalContributionRepository().findAll().size());
    }
}
