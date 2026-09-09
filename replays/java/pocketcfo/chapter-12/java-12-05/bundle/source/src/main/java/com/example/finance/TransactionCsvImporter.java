package com.example.finance;

import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVRecord;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Imports transactions from vendor CSV exports whose column headers vary
 * (e.g. "Date" vs "Transaction Date", a signed "Amount" vs separate
 * "Debit"/"Credit" columns). Never persists anything itself and never lets a
 * bad row or a bad file crash the caller: whole-file problems are reported
 * via {@link TransactionCsvImportException}, per-row problems are collected
 * into the returned {@link ImportResult} so the caller can decide what to
 * show the user.
 */
public final class TransactionCsvImporter {

    private static final List<DateTimeFormatter> DATE_FORMATS = List.of(
            DateTimeFormatter.ISO_LOCAL_DATE,
            DateTimeFormatter.ofPattern("M/d/yyyy", Locale.ROOT));

    public record RowError(long rowNumber, String reason) {
    }

    public record ImportResult(List<TransactionDraft> rows, List<RowError> errors) {
        public int successCount() {
            return rows.size();
        }

        public int errorCount() {
            return errors.size();
        }
    }

    public ImportResult importFile(Path csvFile) {
        CSVFormat format = CSVFormat.Builder.create(CSVFormat.DEFAULT)
                .setHeader()
                .setSkipHeaderRecord(true)
                .setTrim(true)
                .setIgnoreEmptyLines(true)
                .setIgnoreSurroundingSpaces(true)
                .build();

        try (BufferedReader reader = Files.newBufferedReader(csvFile, StandardCharsets.UTF_8);
             CSVParser parser = CSVParser.parse(reader, format)) {
            return importFrom(parser);
        } catch (IOException e) {
            throw new TransactionCsvImportException("Could not read file: " + csvFile + " (" + e.getMessage() + ")", e);
        } catch (UncheckedIOException | IllegalStateException | IllegalArgumentException e) {
            throw new TransactionCsvImportException("Could not parse file: " + csvFile + " (" + e.getMessage() + ")", e);
        }
    }

    private ImportResult importFrom(CSVParser parser) {
        Map<String, Integer> headerMap = parser.getHeaderMap();
        if (headerMap == null || headerMap.isEmpty()) {
            throw new TransactionCsvImportException("CSV file is empty or has no header row");
        }

        ColumnLayout columns = ColumnLayout.resolve(headerMap);

        List<TransactionDraft> rows = new ArrayList<>();
        List<RowError> errors = new ArrayList<>();
        Iterator<CSVRecord> iterator = parser.iterator();
        while (true) {
            CSVRecord record;
            try {
                if (!iterator.hasNext()) {
                    break;
                }
                record = iterator.next();
            } catch (RuntimeException e) {
                errors.add(new RowError(-1, "Stopped reading file: " + e.getMessage()));
                break;
            }

            try {
                rows.add(parseRow(record, columns));
            } catch (RuntimeException e) {
                errors.add(new RowError(record.getRecordNumber(), e.getMessage()));
            }
        }

        return new ImportResult(rows, errors);
    }

    private TransactionDraft parseRow(CSVRecord record, ColumnLayout columns) {
        LocalDate date = parseDate(record.get(columns.dateIndex()));
        String description = columns.descriptionIndex() >= 0 ? record.get(columns.descriptionIndex()) : "";
        String categoryName = columns.categoryIndex() >= 0 ? record.get(columns.categoryIndex()) : "Uncategorized";
        if (categoryName.isBlank()) {
            categoryName = "Uncategorized";
        }

        AmountAndType amountAndType = columns.amountIndex() >= 0
                ? fromSignedAmount(record.get(columns.amountIndex()))
                : fromDebitCredit(record.get(columns.debitIndex()), record.get(columns.creditIndex()));

        return new TransactionDraft(date, amountAndType.type(), categoryName, amountAndType.amount(), description);
    }

    private LocalDate parseDate(String raw) {
        String trimmed = raw.trim();
        for (DateTimeFormatter formatter : DATE_FORMATS) {
            try {
                return LocalDate.parse(trimmed, formatter);
            } catch (DateTimeParseException ignored) {
                // try the next format
            }
        }
        throw new IllegalArgumentException("Unparseable date '" + raw + "' (expected yyyy-MM-dd or M/d/yyyy)");
    }

    private AmountAndType fromSignedAmount(String raw) {
        BigDecimal value = parseAmount(raw);
        int signum = value.signum();
        if (signum == 0) {
            throw new IllegalArgumentException("Zero-amount row skipped - sign is ambiguous");
        }
        return signum < 0
                ? new AmountAndType(value.abs(), TransactionType.EXPENSE)
                : new AmountAndType(value, TransactionType.INCOME);
    }

    private AmountAndType fromDebitCredit(String debitRaw, String creditRaw) {
        boolean hasDebit = !isBlank(debitRaw);
        boolean hasCredit = !isBlank(creditRaw);
        if (hasDebit && hasCredit) {
            throw new IllegalArgumentException("Row has both a Debit and a Credit value - ambiguous");
        }
        if (hasDebit) {
            return new AmountAndType(parseAmount(debitRaw).abs(), TransactionType.EXPENSE);
        }
        if (hasCredit) {
            return new AmountAndType(parseAmount(creditRaw).abs(), TransactionType.INCOME);
        }
        throw new IllegalArgumentException("Row has neither a Debit nor a Credit value");
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private BigDecimal parseAmount(String raw) {
        String cleaned = raw.trim().replace("$", "").replace(",", "");
        try {
            return new BigDecimal(cleaned);
        } catch (NumberFormatException e) {
            throw new NumberFormatException("Unparseable amount '" + raw + "'");
        }
    }

    private record AmountAndType(BigDecimal amount, TransactionType type) {
    }

    private record ColumnLayout(int dateIndex, int amountIndex, int debitIndex, int creditIndex,
                                 int descriptionIndex, int categoryIndex) {

        static ColumnLayout resolve(Map<String, Integer> headerMap) {
            Map<String, Integer> normalized = new java.util.HashMap<>();
            for (Map.Entry<String, Integer> entry : headerMap.entrySet()) {
                normalized.put(entry.getKey().trim().toLowerCase(Locale.ROOT), entry.getValue());
            }

            int dateIndex = firstMatch(normalized, "date", "transaction date");
            int amountIndex = firstMatch(normalized, "amount");
            int debitIndex = firstMatch(normalized, "debit");
            int creditIndex = firstMatch(normalized, "credit");
            int descriptionIndex = firstMatch(normalized, "description");
            int categoryIndex = firstMatch(normalized, "category");

            if (dateIndex < 0) {
                throw new TransactionCsvImportException("CSV is missing a Date/'Transaction Date' column");
            }
            if (amountIndex < 0 && (debitIndex < 0 || creditIndex < 0)) {
                throw new TransactionCsvImportException(
                        "CSV is missing an Amount column (or both Debit and Credit columns)");
            }

            return new ColumnLayout(dateIndex, amountIndex, debitIndex, creditIndex, descriptionIndex, categoryIndex);
        }

        private static int firstMatch(Map<String, Integer> normalized, String... aliases) {
            for (String alias : aliases) {
                Integer index = normalized.get(alias);
                if (index != null) {
                    return index;
                }
            }
            return -1;
        }
    }
}
