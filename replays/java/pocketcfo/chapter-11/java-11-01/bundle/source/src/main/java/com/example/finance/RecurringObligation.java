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

    public RecurringObligation(String name, String categoryName, BigDecimal amount, int intervalMonths,
                                LocalDate startDate, LocalDate endDate, String description) {
        if (intervalMonths < 1 || intervalMonths > 12) {
            throw new IllegalArgumentException("intervalMonths must be between 1 and 12.");
        }
        this.name = name;
        this.categoryName = categoryName;
        this.amount = amount;
        this.intervalMonths = intervalMonths;
        this.startDate = startDate;
        this.endDate = endDate;
        this.description = description;
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

    @Override
    public String toString() {
        return name;
    }
}
