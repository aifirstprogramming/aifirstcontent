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
    private final CategoryService categoryService;

    public RecurringObligationService(RecurringObligationRepository recurringObligationRepository,
                                       TransactionRepository transactionRepository,
                                       CategoryRepository categoryRepository,
                                       CategoryService categoryService) {
        this.recurringObligationRepository = recurringObligationRepository;
        this.transactionRepository = transactionRepository;
        this.categoryRepository = categoryRepository;
        this.categoryService = categoryService;
    }

    /**
     * Adds the obligation, and — since it needs to be pickable as its own
     * category when logging a payment toward it — creates a matching
     * category if one with this name doesn't already exist, with its
     * target seeded from the obligation's monthly-equivalent cost.
     */
    public void addObligation(RecurringObligation obligation) {
        recurringObligationRepository.add(obligation);
        ensureCategoryExists(obligation.getName(), monthlyEquivalent(obligation));
    }

    /**
     * Updates an obligation, and — if the name changed — cascades the
     * rename to any transactions already logged against it and to its
     * matching category, if any. Also backfills a matching category if
     * this obligation predates that guarantee. An already-existing
     * category's target is left alone — only a newly created one is
     * seeded from the monthly-equivalent, so a target the user has since
     * customized isn't silently overwritten.
     */
    public void updateObligation(String originalName, RecurringObligation updated) {
        recurringObligationRepository.update(originalName, updated);
        if (!originalName.equals(updated.getName())) {
            transactionRepository.renameCategory(originalName, updated.getName());
            categoryRepository.findAll().stream()
                    .filter(c -> c.getName().equals(originalName))
                    .findFirst()
                    .ifPresent(existingCategory -> categoryService.update(
                            originalName, new Category(updated.getName(), existingCategory.getMonthlyTarget())));
        }
        ensureCategoryExists(updated.getName(), monthlyEquivalent(updated));
    }

    /**
     * The obligation's starting balance plus every expense transaction
     * logged against its own matching category — i.e. it goes up
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

    private void ensureCategoryExists(String name, BigDecimal monthlyTarget) {
        boolean categoryExists = categoryRepository.findAll().stream()
                .anyMatch(c -> c.getName().equals(name));
        if (!categoryExists) {
            categoryRepository.add(new Category(name, monthlyTarget));
        }
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
