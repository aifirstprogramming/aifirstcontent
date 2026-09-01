package com.example.finance;

import java.math.BigDecimal;
import java.util.Optional;

public class Category {

    private final String name;
    private final BigDecimal monthlyTarget;
    private final Integer priority;

    public Category(String name, BigDecimal monthlyTarget) {
        this(name, monthlyTarget, null);
    }

    /**
     * @param priority optional rank (1 = highest priority); null means this
     *                  category hasn't been prioritized.
     */
    public Category(String name, BigDecimal monthlyTarget, Integer priority) {
        this.name = name;
        this.monthlyTarget = monthlyTarget;
        this.priority = priority;
    }

    public String getName() {
        return name;
    }

    public BigDecimal getMonthlyTarget() {
        return monthlyTarget;
    }

    public Optional<Integer> getPriority() {
        return Optional.ofNullable(priority);
    }

    @Override
    public String toString() {
        return name;
    }
}
