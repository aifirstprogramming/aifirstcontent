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

class RecurringObligationServiceTest {

    private RecurringObligationRepository newRepository(Path tempDir) {
        return new RecurringObligationRepository(new DataPaths(tempDir));
    }

    @Test
    void computesMonthlyEquivalentPerFrequency(@TempDir Path tempDir) {
        RecurringObligationRepository repository = newRepository(tempDir);
        RecurringObligationService service = new RecurringObligationService(repository);

        RecurringObligation annual = new RecurringObligation("Streaming", "Subscriptions",
                new BigDecimal("120.00"), 12, LocalDate.of(2026, 1, 15), null, null);
        RecurringObligation quarterly = new RecurringObligation("Pest control", "Home",
                new BigDecimal("90.00"), 3, LocalDate.of(2026, 1, 1), null, null);

        assertEquals(new BigDecimal("10.00"), service.monthlyEquivalent(annual));
        assertEquals(new BigDecimal("30.00"), service.monthlyEquivalent(quarterly));
    }

    @Test
    void rollsUpMonthlyEquivalentPerCategoryForActiveObligationsOnly(@TempDir Path tempDir) {
        RecurringObligationRepository repository = newRepository(tempDir);
        RecurringObligationService service = new RecurringObligationService(repository);

        repository.add(new RecurringObligation("Streaming", "Subscriptions",
                new BigDecimal("120.00"), 12, LocalDate.of(2026, 1, 15), null, null));
        repository.add(new RecurringObligation("Old gym plan", "Subscriptions",
                new BigDecimal("240.00"), 12, LocalDate.of(2024, 1, 1), LocalDate.of(2025, 12, 31), null));

        assertEquals(new BigDecimal("10.00"),
                service.monthlyEquivalentForCategory("Subscriptions", YearMonth.of(2026, 8)));
    }

    @Test
    void upcomingPaymentsIncludesDueDateExactlyAtWindowBoundary(@TempDir Path tempDir) {
        RecurringObligationRepository repository = newRepository(tempDir);
        RecurringObligationService service = new RecurringObligationService(repository);
        LocalDate today = LocalDate.of(2026, 8, 14);

        // First occurrence is in the future, so it's returned as-is by the
        // "not yet started" branch — landing it exactly on the window edge.
        repository.add(new RecurringObligation("On the edge", "Subscriptions",
                new BigDecimal("50.00"), 1, today.plusDays(60), null, null));

        List<RecurringObligationService.UpcomingPayment> upcoming = service.upcomingPayments(today, 60);

        assertTrue(upcoming.stream().anyMatch(p -> p.getDueDate().equals(today.plusDays(60))));
    }

    @Test
    void upcomingPaymentsExcludesDueDateJustPastWindowBoundary(@TempDir Path tempDir) {
        RecurringObligationRepository repository = newRepository(tempDir);
        RecurringObligationService service = new RecurringObligationService(repository);
        LocalDate today = LocalDate.of(2026, 8, 14);

        repository.add(new RecurringObligation("Just past", "Subscriptions",
                new BigDecimal("50.00"), 1, today.plusDays(61), null, null));

        List<RecurringObligationService.UpcomingPayment> upcoming = service.upcomingPayments(today, 60);

        assertTrue(upcoming.stream().noneMatch(p -> p.getDueDate().equals(today.plusDays(61))));
    }
}
