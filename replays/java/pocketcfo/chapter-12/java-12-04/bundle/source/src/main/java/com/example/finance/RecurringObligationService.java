package com.example.finance;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

/**
 * Monthly-equivalent cost of spread expenses (annual subscriptions, etc.),
 * which obligations are due within a lookahead window, and how much has
 * been paid toward each one so far.
 */
public class RecurringObligationService {

    private static final int DEFAULT_LOOKAHEAD_DAYS = 60;

    private final RecurringObligationRepository recurringObligationRepository;
    private final TransactionRepository transactionRepository;
    private final CategoryRepository categoryRepository;

    public RecurringObligationService(RecurringObligationRepository recurringObligationRepository,
                                       TransactionRepository transactionRepository,
                                       CategoryRepository categoryRepository) {
        this.recurringObligationRepository = recurringObligationRepository;
        this.transactionRepository = transactionRepository;
        this.categoryRepository = categoryRepository;
    }

    public void addObligation(RecurringObligation obligation) {
        validateCategoryExists(obligation.getCategoryName());
        recurringObligationRepository.add(obligation);
    }

    /**
     * Updates an obligation, and — if the name changed — cascades the
     * rename to any transactions already logged directly against it (its
     * assigned category is a separate field, untouched by this).
     */
    public void updateObligation(String originalName, RecurringObligation updated) {
        validateCategoryExists(updated.getCategoryName());
        recurringObligationRepository.update(originalName, updated);
        if (!originalName.equals(updated.getName())) {
            transactionRepository.renameCategory(originalName, updated.getName());
        }
    }

    private void validateCategoryExists(String categoryName) {
        boolean exists = categoryRepository.findAll().stream().anyMatch(c -> c.getName().equals(categoryName));
        if (!exists) {
            throw new IllegalArgumentException("No such category: \"" + categoryName + "\".");
        }
    }

    /**
     * The obligation's starting balance plus every expense transaction
     * logged directly against it (by its own name) — i.e. it goes up
     * automatically as payments are recorded, no manual bookkeeping needed
     * beyond the optional starting balance.
     */
    public BigDecimal totalPaid(RecurringObligation obligation) {
        BigDecimal fromTransactions = transactionRepository.findAll().stream()
                .filter(t -> t.getType() == TransactionType.EXPENSE)
                .filter(t -> t.getCategoryName().equals(obligation.getName()))
                .map(Transaction::getAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        return obligation.getAmountPaid().add(fromTransactions);
    }

    public BigDecimal monthlyEquivalent(RecurringObligation obligation) {
        return obligation.getAmount().divide(BigDecimal.valueOf(obligation.getIntervalMonths()), 2, RoundingMode.HALF_UP);
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
