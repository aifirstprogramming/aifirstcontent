package com.example.finance;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TransactionCsvImporterTest {

    private final TransactionCsvImporter importer = new TransactionCsvImporter();

    @Test
    void importsRowsWithStandardDateAndSignedAmountHeaders(@TempDir Path tempDir) throws Exception {
        Path file = tempDir.resolve("import.csv");
        Files.writeString(file, String.join("\n",
                "Date,Amount,Description,Category",
                "2026-08-01,2500.00,August paycheck,Salary",
                "2026-08-03,-64.32,Weekly shop,Groceries") + "\n");

        TransactionCsvImporter.ImportResult result = importer.importFile(file);

        assertEquals(2, result.successCount());
        assertEquals(0, result.errorCount());
        TransactionDraft income = result.rows().get(0);
        assertEquals(TransactionType.INCOME, income.type());
        assertEquals(new BigDecimal("2500.00"), income.amount());
        TransactionDraft expense = result.rows().get(1);
        assertEquals(TransactionType.EXPENSE, expense.type());
        assertEquals(new BigDecimal("64.32"), expense.amount());
    }

    @Test
    void resolvesTransactionDateHeaderAlias(@TempDir Path tempDir) throws Exception {
        Path file = tempDir.resolve("import.csv");
        Files.writeString(file, String.join("\n",
                "Transaction Date,Amount,Description",
                "2026-08-05,10.00,Coffee") + "\n");

        TransactionCsvImporter.ImportResult result = importer.importFile(file);

        assertEquals(1, result.successCount());
        assertEquals(LocalDate.of(2026, 8, 5), result.rows().get(0).date());
    }

    @Test
    void importsRowsWithDebitCreditColumnsInsteadOfAmount(@TempDir Path tempDir) throws Exception {
        Path file = tempDir.resolve("import.csv");
        Files.writeString(file, String.join("\n",
                "Date,Description,Debit,Credit,Category",
                "2026-08-01,Paycheck,,2500.00,Salary",
                "2026-08-03,Groceries,64.32,,Groceries") + "\n");

        TransactionCsvImporter.ImportResult result = importer.importFile(file);

        assertEquals(2, result.successCount());
        assertEquals(TransactionType.INCOME, result.rows().get(0).type());
        assertEquals(new BigDecimal("2500.00"), result.rows().get(0).amount());
        assertEquals(TransactionType.EXPENSE, result.rows().get(1).type());
        assertEquals(new BigDecimal("64.32"), result.rows().get(1).amount());
    }

    @Test
    void defaultsCategoryToUncategorizedWhenColumnIsAbsent(@TempDir Path tempDir) throws Exception {
        Path file = tempDir.resolve("import.csv");
        Files.writeString(file, String.join("\n",
                "Date,Amount,Description",
                "2026-08-01,10.00,Coffee") + "\n");

        TransactionCsvImporter.ImportResult result = importer.importFile(file);

        assertEquals("Uncategorized", result.rows().get(0).categoryName());
    }

    @Test
    void parsesBothIsoAndUsSlashDateFormatsInTheSameFile(@TempDir Path tempDir) throws Exception {
        Path file = tempDir.resolve("import.csv");
        Files.writeString(file, String.join("\n",
                "Date,Amount,Description",
                "2026-08-05,10.00,Coffee",
                "8/5/2026,20.00,Lunch") + "\n");

        TransactionCsvImporter.ImportResult result = importer.importFile(file);

        assertEquals(2, result.successCount());
        assertEquals(LocalDate.of(2026, 8, 5), result.rows().get(0).date());
        assertEquals(LocalDate.of(2026, 8, 5), result.rows().get(1).date());
    }

    @Test
    void handlesQuotedDescriptionsWithEmbeddedCommas(@TempDir Path tempDir) throws Exception {
        Path file = tempDir.resolve("import.csv");
        Files.writeString(file, String.join("\n",
                "Date,Amount,Description",
                "2026-08-01,10.00,\"Coffee Shop, Inc.\"") + "\n");

        TransactionCsvImporter.ImportResult result = importer.importFile(file);

        assertEquals(1, result.successCount());
        assertEquals("Coffee Shop, Inc.", result.rows().get(0).description());
    }

    @Test
    void skipsMalformedRowsWithoutLosingValidRowsInSameFile(@TempDir Path tempDir) throws Exception {
        Path file = tempDir.resolve("import.csv");
        Files.writeString(file, String.join("\n",
                "Date,Amount,Description",
                "2026-08-01,10.00,Good row",
                "not-a-date,10.00,Bad date",
                "2026-08-02,not-a-number,Bad amount",
                "2026-08-03,20.00,Another good row") + "\n");

        TransactionCsvImporter.ImportResult result = importer.importFile(file);

        assertEquals(2, result.successCount());
        assertEquals(2, result.errorCount());
        assertTrue(result.rows().stream().anyMatch(r -> r.description().equals("Good row")));
        assertTrue(result.rows().stream().anyMatch(r -> r.description().equals("Another good row")));
    }

    @Test
    void skipsRowWithBothDebitAndCreditFilled(@TempDir Path tempDir) throws Exception {
        Path file = tempDir.resolve("import.csv");
        Files.writeString(file, String.join("\n",
                "Date,Description,Debit,Credit",
                "2026-08-01,Ambiguous,5.00,5.00") + "\n");

        TransactionCsvImporter.ImportResult result = importer.importFile(file);

        assertEquals(0, result.successCount());
        assertEquals(1, result.errorCount());
    }

    @Test
    void skipsZeroAmountRowAsAmbiguousSign(@TempDir Path tempDir) throws Exception {
        Path file = tempDir.resolve("import.csv");
        Files.writeString(file, String.join("\n",
                "Date,Amount,Description",
                "2026-08-01,0.00,Zero") + "\n");

        TransactionCsvImporter.ImportResult result = importer.importFile(file);

        assertEquals(0, result.successCount());
        assertEquals(1, result.errorCount());
    }

    @Test
    void throwsWhenDateColumnIsMissingEntirely(@TempDir Path tempDir) throws Exception {
        Path file = tempDir.resolve("import.csv");
        Files.writeString(file, String.join("\n",
                "Amount,Description",
                "10.00,Coffee") + "\n");

        assertThrows(TransactionCsvImportException.class, () -> importer.importFile(file));
    }

    @Test
    void throwsWhenNeitherAmountNorDebitCreditColumnsArePresent(@TempDir Path tempDir) throws Exception {
        Path file = tempDir.resolve("import.csv");
        Files.writeString(file, String.join("\n",
                "Date,Description",
                "2026-08-01,Coffee") + "\n");

        assertThrows(TransactionCsvImportException.class, () -> importer.importFile(file));
    }

    @Test
    void throwsOnCompletelyEmptyFile(@TempDir Path tempDir) throws Exception {
        Path file = tempDir.resolve("import.csv");
        Files.writeString(file, "");

        assertThrows(TransactionCsvImportException.class, () -> importer.importFile(file));
    }

    @Test
    void returnsEmptyResultForHeaderOnlyFileWithNoDataRows(@TempDir Path tempDir) throws Exception {
        Path file = tempDir.resolve("import.csv");
        Files.writeString(file, "Date,Amount,Description\n");

        TransactionCsvImporter.ImportResult result = importer.importFile(file);

        assertEquals(List.of(), result.rows());
        assertEquals(List.of(), result.errors());
    }
}
