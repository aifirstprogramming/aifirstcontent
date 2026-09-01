package com.example.finance;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.math.BigDecimal;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
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
        RecurringObligationService service = new RecurringObligationService(
                repository, transactionRepository, categoryRepository);
        return new Fixture(service, repository, transactionRepository, categoryRepository);
    }

    @Test
    void computesMonthlyEquivalentPerFrequency(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);

        RecurringObligation annual = new RecurringObligation("Streaming", "Streaming",
                new BigDecimal("120.00"), 12, LocalDate.of(2026, 1, 15), null, null);
        RecurringObligation quarterly = new RecurringObligation("Pest control", "Pest control",
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
        fixture.repository().add(new RecurringObligation("On the edge", "On the edge",
                new BigDecimal("50.00"), 1, today.plusDays(60), null, null));

        List<RecurringObligationService.UpcomingPayment> upcoming = fixture.service().upcomingPayments(today, 60);

        assertTrue(upcoming.stream().anyMatch(p -> p.getDueDate().equals(today.plusDays(60))));
    }

    @Test
    void upcomingPaymentsExcludesDueDateJustPastWindowBoundary(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        LocalDate today = LocalDate.of(2026, 8, 14);

        fixture.repository().add(new RecurringObligation("Just past", "Just past",
                new BigDecimal("50.00"), 1, today.plusDays(61), null, null));

        List<RecurringObligationService.UpcomingPayment> upcoming = fixture.service().upcomingPayments(today, 60);

        assertTrue(upcoming.stream().noneMatch(p -> p.getDueDate().equals(today.plusDays(61))));
    }

    @Test
    void addObligationRejectsACategoryNameThatDoesNotExist(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);

        assertThrows(IllegalArgumentException.class, () -> fixture.service().addObligation(
                new RecurringObligation("Car loan", "No such category", new BigDecimal("450.00"),
                        1, LocalDate.of(2026, 1, 1), null, null)));
    }

    @Test
    void updateObligationRejectsACategoryNameThatDoesNotExist(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        fixture.categoryRepository().add(new Category("Loans", BigDecimal.ZERO));
        fixture.service().addObligation(new RecurringObligation("Car loan", "Loans", new BigDecimal("450.00"),
                1, LocalDate.of(2026, 1, 1), null, null));

        assertThrows(IllegalArgumentException.class, () -> fixture.service().updateObligation("Car loan",
                new RecurringObligation("Car loan", "No such category", new BigDecimal("450.00"),
                        1, LocalDate.of(2026, 1, 1), null, null)));
    }

    @Test
    void totalPaidCombinesStartingBalanceWithMatchingTransactions(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        fixture.categoryRepository().add(new Category("Loans", BigDecimal.ZERO));
        RecurringObligation carLoan = new RecurringObligation("Car loan", "Loans", new BigDecimal("450.00"),
                1, LocalDate.of(2026, 1, 1), null, null, new BigDecimal("2000.00"));
        fixture.service().addObligation(carLoan);
        fixture.transactionRepository().add(LocalDate.of(2026, 8, 1), TransactionType.EXPENSE, "Car loan",
                new BigDecimal("450.00"), "August payment");
        fixture.transactionRepository().add(LocalDate.of(2026, 8, 1), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("60.00"), "unrelated");

        assertEquals(new BigDecimal("2450.00"), fixture.service().totalPaid(carLoan));
    }

    @Test
    void updateObligationRenameCascadesToTransactions(@TempDir Path tempDir) {
        Fixture fixture = newFixture(tempDir);
        fixture.categoryRepository().add(new Category("Loans", BigDecimal.ZERO));
        RecurringObligation carLoan = new RecurringObligation("Car loan", "Loans", new BigDecimal("450.00"),
                1, LocalDate.of(2026, 1, 1), null, null);
        fixture.service().addObligation(carLoan);
        fixture.transactionRepository().add(LocalDate.of(2026, 8, 1), TransactionType.EXPENSE, "Car loan",
                new BigDecimal("450.00"), "August payment");

        fixture.service().updateObligation("Car loan", new RecurringObligation("Truck loan", "Loans",
                new BigDecimal("450.00"), 1, LocalDate.of(2026, 1, 1), null, null));

        assertTrue(fixture.transactionRepository().findAll().stream()
                .allMatch(t -> t.getCategoryName().equals("Truck loan")));
    }
}
