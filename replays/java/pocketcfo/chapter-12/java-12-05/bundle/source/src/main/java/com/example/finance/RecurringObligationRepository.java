package com.example.finance;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class RecurringObligationRepository {

    private final DataPaths dataPaths;
    private final List<RecurringObligation> obligations = new ArrayList<>();

    public RecurringObligationRepository(DataPaths dataPaths) {
        this.dataPaths = dataPaths;
        load();
    }

    public List<RecurringObligation> findAll() {
        return Collections.unmodifiableList(obligations);
    }

    public void add(RecurringObligation obligation) {
        obligations.add(obligation);
        persist();
    }

    public void update(String originalName, RecurringObligation updated) {
        for (int i = 0; i < obligations.size(); i++) {
            if (obligations.get(i).getName().equals(originalName)) {
                obligations.set(i, updated);
                break;
            }
        }
        persist();
    }

    public void remove(String name) {
        obligations.removeIf(obligation -> obligation.getName().equals(name));
        persist();
    }

    private void load() {
        for (String line : dataPaths.readLines(dataPaths.recurringObligationsFile())) {
            if (line.isBlank() || line.startsWith("#")) {
                continue;
            }
            try {
                String[] parts = line.split("\\|", -1);
                // The categoryName column returned once obligations needed to
                // point at a real assigned category again. Lines written
                // while obligations were their own category lack it and are
                // shifted rather than lost; they default categoryName to the
                // obligation's own name.
                int offset = parts.length >= 8 ? 1 : 0;
                String name = parts[0];
                String categoryName = offset == 1 ? parts[1] : name;
                BigDecimal amount = new BigDecimal(parts[1 + offset]);
                int intervalMonths = Integer.parseInt(parts[2 + offset]);
                LocalDate startDate = LocalDate.parse(parts[3 + offset]);
                LocalDate endDate = parts[4 + offset].isEmpty() ? null : LocalDate.parse(parts[4 + offset]);
                String description = parts[5 + offset];
                int paidIndex = 6 + offset;
                BigDecimal amountPaid = parts.length > paidIndex && !parts[paidIndex].isEmpty()
                        ? new BigDecimal(parts[paidIndex]) : BigDecimal.ZERO;
                obligations.add(new RecurringObligation(name, categoryName, amount, intervalMonths, startDate,
                        endDate, description, amountPaid));
            } catch (RuntimeException e) {
                System.err.println("Skipping malformed recurring obligation line: " + line + " (" + e.getMessage() + ")");
            }
        }
    }

    private void persist() {
        List<String> lines = new ArrayList<>();
        lines.add("# name|categoryName|amount|intervalMonths|startDate|endDate|description|amountPaid");
        for (RecurringObligation obligation : obligations) {
            lines.add(obligation.getName() + "|" + obligation.getCategoryName() + "|" + obligation.getAmount() + "|"
                    + obligation.getIntervalMonths() + "|" + obligation.getStartDate() + "|"
                    + obligation.getEndDate().map(LocalDate::toString).orElse("") + "|"
                    + obligation.getDescription().orElse("") + "|" + obligation.getAmountPaid());
        }
        dataPaths.writeLinesAtomic(dataPaths.recurringObligationsFile(), lines);
    }

    public void renameCategory(String oldName, String newName) {
        for (int i = 0; i < obligations.size(); i++) {
            RecurringObligation obligation = obligations.get(i);
            if (obligation.getCategoryName().equals(oldName)) {
                obligations.set(i, new RecurringObligation(obligation.getName(), newName, obligation.getAmount(),
                        obligation.getIntervalMonths(), obligation.getStartDate(),
                        obligation.getEndDate().orElse(null), obligation.getDescription().orElse(null),
                        obligation.getAmountPaid()));
            }
        }
        persist();
    }
}
