package com.example.finance;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

/**
 * Monthly-equivalent cost of spread expenses (annual subscriptions, etc.)
 * and which obligations are due within a lookahead window.
 */
public class RecurringObligationService {

    private static final int DEFAULT_LOOKAHEAD_DAYS = 60;

    private final RecurringObligationRepository recurringObligationRepository;

    public RecurringObligationService(RecurringObligationRepository recurringObligationRepository) {
        this.recurringObligationRepository = recurringObligationRepository;
    }

    public BigDecimal monthlyEquivalent(RecurringObligation obligation) {
        return obligation.getAmount().divide(BigDecimal.valueOf(obligation.getIntervalMonths()), 2, RoundingMode.HALF_UP);
    }

    public BigDecimal monthlyEquivalentForCategory(String categoryName, YearMonth month) {
        BigDecimal total = BigDecimal.ZERO;
        for (RecurringObligation obligation : recurringObligationRepository.findAll()) {
            if (!obligation.getCategoryName().equals(categoryName)) {
                continue;
            }
            if (isActiveDuring(obligation, month)) {
                total = total.add(monthlyEquivalent(obligation));
            }
        }
        return total;
    }

    public List<UpcomingPayment> upcomingPayments(LocalDate today) {
        return upcomingPayments(today, DEFAULT_LOOKAHEAD_DAYS);
    }

    public List<UpcomingPayment> upcomingPayments(LocalDate today, int lookaheadDays) {
        LocalDate windowEnd = today.plusDays(lookaheadDays);
        List<UpcomingPayment> upcoming = new ArrayList<>();
        for (RecurringObligation obligation : recurringObligationRepository.findAll()) {
            LocalDate nextDue = nextOccurrenceOnOrAfter(obligation, today);
            if (nextDue != null && !nextDue.isAfter(windowEnd)) {
                upcoming.add(new UpcomingPayment(obligation, nextDue));
            }
        }
        upcoming.sort((a, b) -> a.getDueDate().compareTo(b.getDueDate()));
        return upcoming;
    }

    private boolean isActiveDuring(RecurringObligation obligation, YearMonth month) {
        if (month.isBefore(YearMonth.from(obligation.getStartDate()))) {
            return false;
        }
        return obligation.getEndDate().map(end -> !month.isAfter(YearMonth.from(end))).orElse(true);
    }

    private LocalDate nextOccurrenceOnOrAfter(RecurringObligation obligation, LocalDate onOrAfter) {
        LocalDate occurrence = obligation.getStartDate();
        if (!occurrence.isBefore(onOrAfter)) {
            return withinEnd(obligation, occurrence) ? occurrence : null;
        }
        long monthsElapsed = ChronoUnit.MONTHS.between(occurrence, onOrAfter);
        long steps = monthsElapsed / obligation.getIntervalMonths();
        LocalDate candidate = occurrence.plusMonths(steps * obligation.getIntervalMonths());
        while (candidate.isBefore(onOrAfter)) {
            candidate = candidate.plusMonths(obligation.getIntervalMonths());
        }
        return withinEnd(obligation, candidate) ? candidate : null;
    }

    private boolean withinEnd(RecurringObligation obligation, LocalDate date) {
        return obligation.getEndDate().map(end -> !date.isAfter(end)).orElse(true);
    }

    public static class UpcomingPayment {
        private final RecurringObligation obligation;
        private final LocalDate dueDate;

        public UpcomingPayment(RecurringObligation obligation, LocalDate dueDate) {
            this.obligation = obligation;
            this.dueDate = dueDate;
        }

        public RecurringObligation getObligation() {
            return obligation;
        }

        public LocalDate getDueDate() {
            return dueDate;
        }
    }
}
