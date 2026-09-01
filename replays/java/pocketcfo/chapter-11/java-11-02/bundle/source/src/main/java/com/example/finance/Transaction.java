package com.example.finance;

import java.math.BigDecimal;
import java.time.LocalDate;

public class Transaction {

    private final long id;
    private final LocalDate date;
    private final TransactionType type;
    private final String categoryName;
    private final BigDecimal amount;
    private final String description;

    public Transaction(long id, LocalDate date, TransactionType type, String categoryName,
                        BigDecimal amount, String description) {
        this.id = id;
        this.date = date;
        this.type = type;
        this.categoryName = categoryName;
        this.amount = amount;
        this.description = description;
    }

    public long getId() {
        return id;
    }

    public LocalDate getDate() {
        return date;
    }

    public TransactionType getType() {
        return type;
    }

    public String getCategoryName() {
        return categoryName;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public String getDescription() {
        return description;
    }
}
