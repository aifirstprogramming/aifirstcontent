package com.example.finance;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Optional;

public class SavingsGoal {

    private final String name;
    private final BigDecimal targetAmount;
    private final LocalDate targetDate;

    public SavingsGoal(String name, BigDecimal targetAmount, LocalDate targetDate) {
        this.name = name;
        this.targetAmount = targetAmount;
        this.targetDate = targetDate;
    }

    public String getName() {
        return name;
    }

    public BigDecimal getTargetAmount() {
        return targetAmount;
    }

    public Optional<LocalDate> getTargetDate() {
        return Optional.ofNullable(targetDate);
    }

    @Override
    public String toString() {
        return name;
    }
}
