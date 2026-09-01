package com.example.finance;

import java.math.BigDecimal;

public class Category {

    private final String name;
    private final BigDecimal monthlyTarget;

    public Category(String name, BigDecimal monthlyTarget) {
        this.name = name;
        this.monthlyTarget = monthlyTarget;
    }

    public String getName() {
        return name;
    }

    public BigDecimal getMonthlyTarget() {
        return monthlyTarget;
    }

    @Override
    public String toString() {
        return name;
    }
}
