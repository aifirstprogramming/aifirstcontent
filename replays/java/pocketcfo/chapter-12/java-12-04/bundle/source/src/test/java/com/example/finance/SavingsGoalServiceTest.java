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
                            SavingsGoalRepository savingsGoalRepository, CategoryRepository categoryRepository,
                            GoalContributionRepository goalContributionRepository) {
    }

    private Fixture newFixture(Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        RecurringObligationRepository recurringObligationRepository = new RecurringObligationRepository(dataPaths);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        BudgetService budgetService = new BudgetService(
                categoryRepository, transactionRepository, savingsGoalRepository, recurringObligationRepository);
        GoalContributionRepository goalContributionRepository = new GoalContributionRepository(dataPaths);
        SavingsGoalService service = new SavingsGoalService(
                savingsGoalRepository, goalContributionRepository, budgetService, categoryRepository);
        return new Fixture(service, transactionRepository, savingsGoalRepository, categoryRepository,
                goalContributionRepository);
    }

    @Test
    void allocationReducesAvailableLeftoverAndIncreasesGoalProgress(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        YearMonth august = YearMonth.of(2026, 8);
        fixture.transactionRepository().add(LocalDate.of(2026, 8, 1), TransactionType.INCOME, "Salary",
                new BigDecimal("1000.00"), "paycheck");
        fixture.savingsGoalRepository().add(
                new SavingsGoal("Emergency fund", new BigDecimal("500.00"), null, "Emergency fund"));

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
        fixture.savingsGoalRepository().add(
                new SavingsGoal("Emergency fund", new BigDecimal("500.00"), null, "Emergency fund"));

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
    void updateGoalRenameCascadesToContributions(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        fixture.categoryRepository().add(new Category("Emergency fund", BigDecimal.ZERO));
        fixture.service().addGoal(new SavingsGoal("Emergency fund", new BigDecimal("500.00"), null, "Emergency fund"));
        fixture.goalContributionRepository().add(LocalDate.of(2026, 8, 1), "Emergency fund", new BigDecimal("100.00"));

        fixture.service().updateGoal("Emergency fund",
                new SavingsGoal("Rainy day fund", new BigDecimal("600.00"), null, "Emergency fund"));

        assertEquals("Rainy day fund", fixture.savingsGoalRepository().findAll().get(0).getName());
        assertEquals(new BigDecimal("100.00"), fixture.service().totalSaved("Rainy day fund"));
        assertEquals(BigDecimal.ZERO.setScale(2), fixture.service().totalSaved("Emergency fund").setScale(2));
    }

    @Test
    void addGoalRejectsACategoryNameThatDoesNotExist(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);

        assertThrows(IllegalArgumentException.class, () -> fixture.service().addGoal(
                new SavingsGoal("Emergency fund", new BigDecimal("500.00"), null, "No such category")));
    }

    @Test
    void updateGoalRejectsACategoryNameThatDoesNotExist(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        fixture.categoryRepository().add(new Category("Emergency fund", BigDecimal.ZERO));
        fixture.service().addGoal(new SavingsGoal("Emergency fund", new BigDecimal("500.00"), null, "Emergency fund"));

        assertThrows(IllegalArgumentException.class, () -> fixture.service().updateGoal("Emergency fund",
                new SavingsGoal("Emergency fund", new BigDecimal("600.00"), null, "No such category")));
    }

    @Test
    void deleteGoalRemovesAGoalWithNoSavings(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        fixture.categoryRepository().add(new Category("Emergency fund", BigDecimal.ZERO));
        fixture.service().addGoal(new SavingsGoal("Emergency fund", new BigDecimal("500.00"), null, "Emergency fund"));

        fixture.service().deleteGoal("Emergency fund");

        assertEquals(0, fixture.savingsGoalRepository().findAll().size());
    }

    @Test
    void deleteGoalRejectsAGoalThatAlreadyHasSavings(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        fixture.categoryRepository().add(new Category("Emergency fund", BigDecimal.ZERO));
        fixture.service().addGoal(new SavingsGoal("Emergency fund", new BigDecimal("500.00"), null, "Emergency fund"));
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
        fixture.categoryRepository().add(new Category("Emergency fund", BigDecimal.ZERO));
        fixture.service().addGoal(new SavingsGoal("Emergency fund", new BigDecimal("500.00"), null, "Emergency fund"));
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
        fixture.categoryRepository().add(new Category("Emergency fund", BigDecimal.ZERO));
        fixture.service().addGoal(new SavingsGoal("Emergency fund", new BigDecimal("500.00"), null, "Emergency fund"));
        GoalContribution contribution = fixture.goalContributionRepository()
                .add(LocalDate.of(2026, 8, 5), "Emergency fund", new BigDecimal("300.00"));

        assertThrows(IllegalArgumentException.class, () -> fixture.service().updateContribution(
                contribution.getId(), LocalDate.of(2026, 8, 5), "Emergency fund",
                new BigDecimal("1000.01"), august));
    }

    @Test
    void deleteContributionRemovesItAndReducesTotalSaved(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        fixture.categoryRepository().add(new Category("Emergency fund", BigDecimal.ZERO));
        fixture.service().addGoal(new SavingsGoal("Emergency fund", new BigDecimal("500.00"), null, "Emergency fund"));
        GoalContribution contribution = fixture.goalContributionRepository()
                .add(LocalDate.of(2026, 8, 5), "Emergency fund", new BigDecimal("300.00"));

        fixture.service().deleteContribution(contribution.getId());

        assertEquals(BigDecimal.ZERO.setScale(2), fixture.service().totalSaved("Emergency fund").setScale(2));
        assertEquals(0, fixture.goalContributionRepository().findAll().size());
    }
}
