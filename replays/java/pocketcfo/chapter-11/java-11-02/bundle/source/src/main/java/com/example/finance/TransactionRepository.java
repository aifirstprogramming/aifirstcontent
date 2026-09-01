package com.example.finance;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class TransactionRepository {

    private final DataPaths dataPaths;
    private final List<Transaction> transactions = new ArrayList<>();
    private long nextId = 1;

    public TransactionRepository(DataPaths dataPaths) {
        this.dataPaths = dataPaths;
        load();
    }

    public List<Transaction> findAll() {
        return Collections.unmodifiableList(transactions);
    }

    public Transaction add(LocalDate date, TransactionType type, String categoryName,
                            BigDecimal amount, String description) {
        Transaction transaction = new Transaction(nextId++, date, type, categoryName, amount, description);
        transactions.add(transaction);
        persist();
        return transaction;
    }

    public void update(long id, LocalDate date, TransactionType type, String categoryName,
                        BigDecimal amount, String description) {
        for (int i = 0; i < transactions.size(); i++) {
            if (transactions.get(i).getId() == id) {
                transactions.set(i, new Transaction(id, date, type, categoryName, amount, description));
                break;
            }
        }
        persist();
    }

    public void remove(long id) {
        transactions.removeIf(transaction -> transaction.getId() == id);
        persist();
    }

    public void renameCategory(String oldName, String newName) {
        for (int i = 0; i < transactions.size(); i++) {
            Transaction transaction = transactions.get(i);
            if (transaction.getCategoryName().equals(oldName)) {
                transactions.set(i, new Transaction(transaction.getId(), transaction.getDate(), transaction.getType(),
                        newName, transaction.getAmount(), transaction.getDescription()));
            }
        }
        persist();
    }

    private void load() {
        for (String line : dataPaths.readLines(dataPaths.transactionsFile())) {
            if (line.isBlank() || line.startsWith("#")) {
                continue;
            }
            try {
                String[] parts = line.split("\\|", -1);
                long id = Long.parseLong(parts[0]);
                LocalDate date = LocalDate.parse(parts[1]);
                TransactionType type = TransactionType.valueOf(parts[2]);
                String categoryName = parts[3];
                BigDecimal amount = new BigDecimal(parts[4]);
                String description = parts[5];
                transactions.add(new Transaction(id, date, type, categoryName, amount, description));
                if (id >= nextId) {
                    nextId = id + 1;
                }
            } catch (RuntimeException e) {
                System.err.println("Skipping malformed transaction line: " + line + " (" + e.getMessage() + ")");
            }
        }
    }

    private void persist() {
        List<String> lines = new ArrayList<>();
        lines.add("# id|date|type|categoryName|amount|description");
        for (Transaction transaction : transactions) {
            lines.add(transaction.getId() + "|" + transaction.getDate() + "|" + transaction.getType() + "|"
                    + transaction.getCategoryName() + "|" + transaction.getAmount() + "|" + transaction.getDescription());
        }
        dataPaths.writeLinesAtomic(dataPaths.transactionsFile(), lines);
    }
}
