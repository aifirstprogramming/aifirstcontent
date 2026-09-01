package com.example.finance;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * A leftover allocation toward a savings goal. Kept as its own append-only
 * log rather than mixed into the transaction ledger, so the expense ledger
 * stays a pure record of money in/out.
 */
public class GoalContribution {

    private final LocalDate date;
    private final String goalName;
    private final BigDecimal amount;

    public GoalContribution(LocalDate date, String goalName, BigDecimal amount) {
        this.date = date;
        this.goalName = goalName;
        this.amount = amount;
    }

    public LocalDate getDate() {
        return date;
    }

    public String getGoalName() {
        return goalName;
    }

    public BigDecimal getAmount() {
        return amount;
    }
}
