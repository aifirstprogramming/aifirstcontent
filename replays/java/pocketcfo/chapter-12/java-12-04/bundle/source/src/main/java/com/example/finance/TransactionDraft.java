package com.example.finance;

import java.math.BigDecimal;
import java.time.LocalDate;

public record TransactionDraft(LocalDate date, TransactionType type, String categoryName,
                                BigDecimal amount, String description) {
}
