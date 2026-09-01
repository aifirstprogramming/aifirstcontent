package com.example.finance;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TransactionRepositoryTest {

    @Test
    void savesAndReloadsTransactions(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);

        TransactionRepository repository = new TransactionRepository(dataPaths);
        repository.add(LocalDate.of(2026, 8, 1), TransactionType.INCOME, "Salary",
                new BigDecimal("2500.00"), "August paycheck");
        repository.add(LocalDate.of(2026, 8, 3), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("64.32"), "Weekly shop");

        TransactionRepository reloaded = new TransactionRepository(dataPaths);
        List<Transaction> transactions = reloaded.findAll();

        assertEquals(2, transactions.size());
        assertEquals("Salary", transactions.get(0).getCategoryName());
        assertEquals(new BigDecimal("2500.00"), transactions.get(0).getAmount());
        assertEquals(TransactionType.EXPENSE, transactions.get(1).getType());
        assertEquals("Weekly shop", transactions.get(1).getDescription());
    }

    @Test
    void skipsMalformedLinesWithoutLosingOtherEntries(@TempDir Path tempDir) throws Exception {
        DataPaths dataPaths = new DataPaths(tempDir);
        Files.createDirectories(tempDir);
        Files.writeString(dataPaths.transactionsFile(), String.join("\n",
                "# id|date|type|categoryName|amount|description",
                "1|2026-08-01|INCOME|Salary|2500.00|August paycheck",
                "not-a-valid-line",
                "2|2026-08-03|EXPENSE|Groceries|64.32|Weekly shop") + "\n");

        TransactionRepository repository = new TransactionRepository(dataPaths);
        List<Transaction> transactions = repository.findAll();

        assertEquals(2, transactions.size());
        assertTrue(transactions.stream().anyMatch(t -> t.getCategoryName().equals("Salary")));
        assertTrue(transactions.stream().anyMatch(t -> t.getCategoryName().equals("Groceries")));
    }

    @Test
    void continuesIdSequenceAfterReload(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        TransactionRepository repository = new TransactionRepository(dataPaths);
        repository.add(LocalDate.of(2026, 8, 1), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("10.00"), "first");

        TransactionRepository reloaded = new TransactionRepository(dataPaths);
        Transaction second = reloaded.add(LocalDate.of(2026, 8, 2), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("20.00"), "second");

        assertEquals(2, second.getId());
    }

    @Test
    void updateReplacesTheMatchingTransaction(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        TransactionRepository repository = new TransactionRepository(dataPaths);
        Transaction original = repository.add(LocalDate.of(2026, 8, 1), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("10.00"), "first");

        repository.update(original.getId(), LocalDate.of(2026, 8, 2), TransactionType.EXPENSE, "Dining",
                new BigDecimal("15.00"), "corrected");

        List<Transaction> transactions = repository.findAll();
        assertEquals(1, transactions.size());
        assertEquals("Dining", transactions.get(0).getCategoryName());
        assertEquals(new BigDecimal("15.00"), transactions.get(0).getAmount());
        assertEquals("corrected", transactions.get(0).getDescription());
    }

    @Test
    void removeDeletesTheMatchingTransaction(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        TransactionRepository repository = new TransactionRepository(dataPaths);
        Transaction toDelete = repository.add(LocalDate.of(2026, 8, 1), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("10.00"), "first");
        repository.add(LocalDate.of(2026, 8, 2), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("20.00"), "second");

        repository.remove(toDelete.getId());

        List<Transaction> transactions = repository.findAll();
        assertEquals(1, transactions.size());
        assertEquals("second", transactions.get(0).getDescription());
    }

    @Test
    void renameCategoryUpdatesAllMatchingTransactions(@TempDir Path tempDir) {
        DataPaths dataPaths = new DataPaths(tempDir);
        TransactionRepository repository = new TransactionRepository(dataPaths);
        repository.add(LocalDate.of(2026, 8, 1), TransactionType.EXPENSE, "Groceries",
                new BigDecimal("10.00"), "first");
        repository.add(LocalDate.of(2026, 8, 2), TransactionType.EXPENSE, "Dining",
                new BigDecimal("20.00"), "unrelated");

        repository.renameCategory("Groceries", "Food");

        List<Transaction> transactions = repository.findAll();
        assertTrue(transactions.stream().anyMatch(t -> t.getCategoryName().equals("Food")));
        assertTrue(transactions.stream().anyMatch(t -> t.getCategoryName().equals("Dining")));
        assertTrue(transactions.stream().noneMatch(t -> t.getCategoryName().equals("Groceries")));
    }
}
