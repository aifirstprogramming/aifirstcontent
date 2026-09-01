package com.example.finance;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.math.BigDecimal;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RecurringObligationServiceTest {

    private record Fixture(RecurringObligationService service, RecurringObligationRepository repository,
                            TransactionRepository transactionRepository, CategoryRepository categoryRepository) {
    }

    private Fixture newFixture(Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        RecurringObligationRepository repository = new RecurringObligationRepository(dataPaths);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        CategoryService categoryService = new CategoryService(
                categoryRepository, transactionRepository, repository, savingsGoalRepository);
        RecurringObligationService service = new RecurringObligationService(
                repository, transactionRepository, categoryRepository, categoryService);
        return new Fixture(service, repository, transactionRepository, categoryRepository);
    }

    @Test
    void computesMonthlyEquivalentPerFrequency(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);

        RecurringObligation annual = new RecurringObligation("Streaming",
                new BigDecimal("120.00"), 12, LocalDate.of(2026, 1, 15), null, null);
        RecurringObligation quarterly = new RecurringObligation("Pest control",
                new BigDecimal("90.00"), 3, LocalDate.of(2026, 1, 1), null, null);

        assertEquals(new BigDecimal("10.00"), fixture.service().monthlyEquivalent(annual));
        assertEquals(new BigDecimal("30.00"), fixture.service().monthlyEquivalent(quarterly));
    }

    @Test
    void upcomingPaymentsIncludesDueDateExactlyAtWindowBoundary(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        LocalDate today = LocalDate.of(2026, 8, 14);

        // First occurrence is in the future, so it's returned as-is by the
        // "not yet started" branch — landing it exactly on the window edge.
        fixture.repository().add(new RecurringObligation("On the edge",
                new BigDecimal("50.00"), 1, today.plusDays(60), null, null));

        List<RecurringObligationService.UpcomingPayment> upcoming = fixture.service().upcomingPayments(today, 60);

        assertTrue(upcoming.stream().anyMatch(p -> p.getDueDate().equals(today.plusDays(60))));
    }

    @Test
    void upcomingPaymentsExcludesDueDateJustPastWindowBoundary(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        LocalDate today = LocalDate.of(2026, 8, 14);

        fixture.repository().add(new RecurringObligation("Just past",
                new BigDecimal("50.00"), 1, today.plusDays(61), null, null));

        List<RecurringObligationService.UpcomingPayment> upcoming = fixture.service().upcomingPayments(today, 60);

        assertTrue(upcoming.stream().noneMatch(p -> p.getDueDate().equals(today.plusDays(61))));
    }

    @Test
    void addObligationCreatesAMatchingCategorySeededWithTheMonthlyEquivalent(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);

        fixture.service().addObligation(new RecurringObligation("Car loan",
                new BigDecimal("450.00"), 1, LocalDate.of(2026, 1, 1), null, null));

        assertEquals(new BigDecimal("450.00"), fixture.categoryRepository().findAll().stream()
                .filter(c -> c.getName().equals("Car loan"))
                .findFirst()
                .map(Category::getMonthlyTarget)
                .orElseThrow());
    }

    @Test
    void updateObligationDoesNotOverwriteAnAlreadyCustomizedCategoryTarget(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        RecurringObligation carLoan = new RecurringObligation("Car loan", new BigDecimal("450.00"),
                1, LocalDate.of(2026, 1, 1), null, null);
        fixture.service().addObligation(carLoan);
        fixture.categoryRepository().update("Car loan", new Category("Car loan", new BigDecimal("999.00")));

        fixture.service().updateObligation("Car loan", new RecurringObligation("Car loan",
                new BigDecimal("500.00"), 1, LocalDate.of(2026, 1, 1), null, "raised payment"));

        assertEquals(new BigDecimal("999.00"), fixture.categoryRepository().findAll().stream()
                .filter(c -> c.getName().equals("Car loan"))
                .findFirst()
                .map(Category::getMonthlyTarget)
                .orElseThrow());
    }

    @Test
    void totalPaidCombinesStartingBalanceWithMatchingTransactions(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        RecurringObligation carLoan = new RecurringObligation("Car loan", new BigDecimal("450.00"),
                1, LocalDate.of(2026, 1, 1), null, null, new BigDecimal("2000.00"));
        fixture.service().addObligation(carLoan);
        fixture.transactionRepository().add(LocalDate.of(2026, 8, 1), TransactionType.EXPENSE, "Car loan",
                new BigDecimal("450.00"), "August payment");
        fixture.transactionRepository().add(LocalDate.of(2026, 8, 1), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("60.00"), "unrelated");

        assertEquals(new BigDecimal("2450.00"), fixture.service().totalPaid(carLoan));
    }

    @Test
    void updateObligationRenameCascadesToTransactionsAndMatchingCategory(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        RecurringObligation carLoan = new RecurringObligation("Car loan", new BigDecimal("450.00"),
                1, LocalDate.of(2026, 1, 1), null, null);
        fixture.service().addObligation(carLoan);
        fixture.transactionRepository().add(LocalDate.of(2026, 8, 1), TransactionType.EXPENSE, "Car loan",
                new BigDecimal("450.00"), "August payment");

        fixture.service().updateObligation("Car loan", new RecurringObligation("Truck loan",
                new BigDecimal("450.00"), 1, LocalDate.of(2026, 1, 1), null, null));

        assertTrue(fixture.transactionRepository().findAll().stream()
                .allMatch(t -> t.getCategoryName().equals("Truck loan")));
        assertTrue(fixture.categoryRepository().findAll().stream().anyMatch(c -> c.getName().equals("Truck loan")));
        assertTrue(fixture.categoryRepository().findAll().stream().noneMatch(c -> c.getName().equals("Car loan")));
    }
}
