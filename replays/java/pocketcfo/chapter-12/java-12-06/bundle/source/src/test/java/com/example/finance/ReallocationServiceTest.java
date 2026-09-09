package com.example.finance;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.math.BigDecimal;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.YearMonth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ReallocationServiceTest {

    private record Fixture(ReallocationService service, CategoryRepository categoryRepository,
                            TransactionRepository transactionRepository,
                            SavingsGoalRepository savingsGoalRepository,
                            GoalContributionRepository goalContributionRepository,
                            RecurringObligationRepository recurringObligationRepository) {
    }

    private Fixture newFixture(Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        RecurringObligationRepository recurringObligationRepository = new RecurringObligationRepository(dataPaths);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        GoalContributionRepository goalContributionRepository = new GoalContributionRepository(dataPaths);
        BudgetService budgetService = new BudgetService(
                categoryRepository, transactionRepository, savingsGoalRepository, recurringObligationRepository);
        SavingsGoalService savingsGoalService = new SavingsGoalService(
                savingsGoalRepository, goalContributionRepository, budgetService, categoryRepository);
        RecurringObligationService recurringObligationService = new RecurringObligationService(
                recurringObligationRepository, transactionRepository, categoryRepository);
        ReallocationService service = new ReallocationService(budgetService, savingsGoalService,
                savingsGoalRepository, recurringObligationRepository, recurringObligationService);
        return new Fixture(service, categoryRepository, transactionRepository, savingsGoalRepository,
                goalContributionRepository, recurringObligationRepository);
    }

    @Test
    void projectsOldAndNewMonthlyTargetAllocatedAndProgressForAGoal(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        fixture.categoryRepository().add(new Category("Dining", new BigDecimal("200.00")));
        fixture.savingsGoalRepository().add(new SavingsGoal("Emergency fund", new BigDecimal("1000.00"), null, "Dining"));
        fixture.goalContributionRepository().add(LocalDate.of(2026, 8, 1), "Emergency fund", new BigDecimal("100.00"));

        ReallocationService.ReallocationProjection projection = fixture.service().projectToGoal(
                "Dining", new BigDecimal("50.00"), "Emergency fund", YearMonth.of(2026, 8));

        // Monthly target before = 200.00; reducing by 50.00 = 150.00
        assertEquals(new BigDecimal("200.00"), projection.getOldMonthlyTarget());
        assertEquals(new BigDecimal("150.00"), projection.getNewMonthlyTarget());
        // Saved before = 100.00; +50.00 reduction = 150.00
        assertEquals(new BigDecimal("100.00"), projection.getOldAllocatedToTarget());
        assertEquals(new BigDecimal("150.00"), projection.getNewAllocatedToTarget());
        assertEquals(0.10, projection.getOldProgressPercent(), 0.0001);
        assertEquals(0.15, projection.getNewProgressPercent(), 0.0001);
        assertEquals(ReallocationService.TargetKind.SAVINGS_GOAL, projection.getTargetKind());
    }

    @Test
    void projectsOldAndNewMonthlyTargetAllocatedAndProgressForAnObligation(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        fixture.categoryRepository().add(new Category("Dining", new BigDecimal("200.00")));
        fixture.categoryRepository().add(new Category("Loans", BigDecimal.ZERO));
        fixture.recurringObligationRepository().add(new RecurringObligation("Car loan", "Loans",
                new BigDecimal("5000.00"), 1, LocalDate.of(2026, 1, 1), null, null, new BigDecimal("2000.00")));

        ReallocationService.ReallocationProjection projection = fixture.service().projectToObligation(
                "Dining", new BigDecimal("50.00"), "Car loan", YearMonth.of(2026, 8));

        assertEquals(new BigDecimal("200.00"), projection.getOldMonthlyTarget());
        assertEquals(new BigDecimal("150.00"), projection.getNewMonthlyTarget());
        // Paid before = 2000.00 (starting balance, no matching transactions); +50.00 = 2050.00
        assertEquals(new BigDecimal("2000.00"), projection.getOldAllocatedToTarget());
        assertEquals(new BigDecimal("2050.00"), projection.getNewAllocatedToTarget());
        assertEquals(0.40, projection.getOldProgressPercent(), 0.0001);
        assertEquals(0.41, projection.getNewProgressPercent(), 0.0001);
        assertEquals(ReallocationService.TargetKind.RECURRING_OBLIGATION, projection.getTargetKind());
    }

    @Test
    void rejectsAZeroOrNegativeReductionAmount(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        fixture.categoryRepository().add(new Category("Dining", new BigDecimal("200.00")));
        fixture.savingsGoalRepository().add(new SavingsGoal("Emergency fund", new BigDecimal("1000.00"), null, "Dining"));

        assertThrows(IllegalArgumentException.class, () -> fixture.service().projectToGoal(
                "Dining", BigDecimal.ZERO, "Emergency fund", YearMonth.of(2026, 8)));
        assertThrows(IllegalArgumentException.class, () -> fixture.service().projectToGoal(
                "Dining", new BigDecimal("-10.00"), "Emergency fund", YearMonth.of(2026, 8)));
    }

    @Test
    void rejectsAReductionThatExceedsTheCategorysMonthlyTarget(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        fixture.categoryRepository().add(new Category("Dining", new BigDecimal("40.00")));
        fixture.savingsGoalRepository().add(new SavingsGoal("Emergency fund", new BigDecimal("1000.00"), null, "Dining"));

        assertThrows(IllegalArgumentException.class, () -> fixture.service().projectToGoal(
                "Dining", new BigDecimal("40.01"), "Emergency fund", YearMonth.of(2026, 8)));
    }

    @Test
    void rejectsAnUnknownCategory(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        fixture.savingsGoalRepository().add(new SavingsGoal("Emergency fund", new BigDecimal("1000.00"), null, "Dining"));

        assertThrows(IllegalArgumentException.class, () -> fixture.service().projectToGoal(
                "No such category", new BigDecimal("50.00"), "Emergency fund", YearMonth.of(2026, 8)));
    }

    @Test
    void rejectsAnUnknownSavingsGoal(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        fixture.categoryRepository().add(new Category("Dining", new BigDecimal("200.00")));

        assertThrows(IllegalArgumentException.class, () -> fixture.service().projectToGoal(
                "Dining", new BigDecimal("50.00"), "No such goal", YearMonth.of(2026, 8)));
    }

    @Test
    void rejectsAnUnknownObligation(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        fixture.categoryRepository().add(new Category("Dining", new BigDecimal("200.00")));

        assertThrows(IllegalArgumentException.class, () -> fixture.service().projectToObligation(
                "Dining", new BigDecimal("50.00"), "No such obligation", YearMonth.of(2026, 8)));
    }

    @Test
    void aGoalWithZeroTargetProjectsZeroProgressInsteadOfDividingByZero(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        fixture.categoryRepository().add(new Category("Dining", new BigDecimal("200.00")));
        fixture.savingsGoalRepository().add(new SavingsGoal("Placeholder goal", BigDecimal.ZERO, null, "Dining"));

        ReallocationService.ReallocationProjection projection = fixture.service().projectToGoal(
                "Dining", new BigDecimal("50.00"), "Placeholder goal", YearMonth.of(2026, 8));

        assertEquals(0.0, projection.getOldProgressPercent(), 0.0001);
        assertEquals(0.0, projection.getNewProgressPercent(), 0.0001);
    }
}
