package com.example.finance;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Optional;

public class RecurringObligation {

    private final String name;
    private final String categoryName;
    private final BigDecimal amount;
    private final int intervalMonths;
    private final LocalDate startDate;
    private final LocalDate endDate;
    private final String description;
    private final BigDecimal amountPaid;

    public RecurringObligation(String name, String categoryName, BigDecimal amount, int intervalMonths,
                                LocalDate startDate, LocalDate endDate, String description) {
        this(name, categoryName, amount, intervalMonths, startDate, endDate, description, BigDecimal.ZERO);
    }

    /**
     * @param amountPaid optional starting balance for money already paid
     *                   toward this obligation before tracking began here;
     *                   defaults to zero. The running total shown to the
     *                   user is this plus whatever transactions get logged
     *                   directly against the obligation going forward.
     */
    public RecurringObligation(String name, String categoryName, BigDecimal amount, int intervalMonths,
                                LocalDate startDate, LocalDate endDate, String description, BigDecimal amountPaid) {
        if (intervalMonths < 1 || intervalMonths > 600) {
            throw new IllegalArgumentException("intervalMonths must be between 1 and 600.");
        }
        this.name = name;
        this.categoryName = categoryName;
        this.amount = amount;
        this.intervalMonths = intervalMonths;
        this.startDate = startDate;
        this.endDate = endDate;
        this.description = description;
        this.amountPaid = amountPaid == null ? BigDecimal.ZERO : amountPaid;
    }

    public String getName() {
        return name;
    }

    public String getCategoryName() {
        return categoryName;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public int getIntervalMonths() {
        return intervalMonths;
    }

    public LocalDate getStartDate() {
        return startDate;
    }

    public Optional<LocalDate> getEndDate() {
        return Optional.ofNullable(endDate);
    }

    public Optional<String> getDescription() {
        return Optional.ofNullable(description).filter(s -> !s.isBlank());
    }

    public BigDecimal getAmountPaid() {
        return amountPaid;
    }

    @Override
    public String toString() {
        return name;
    }
}
