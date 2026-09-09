package com.example.finance;

public class TransactionCsvImportException extends RuntimeException {

    public TransactionCsvImportException(String message) {
        super(message);
    }

    public TransactionCsvImportException(String message, Throwable cause) {
        super(message, cause);
    }
}
