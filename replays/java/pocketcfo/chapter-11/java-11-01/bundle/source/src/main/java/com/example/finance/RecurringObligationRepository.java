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

    private void load() {
        for (String line : dataPaths.readLines(dataPaths.recurringObligationsFile())) {
            if (line.isBlank() || line.startsWith("#")) {
                continue;
            }
            try {
                String[] parts = line.split("\\|", -1);
                String name = parts[0];
                String categoryName = parts[1];
                BigDecimal amount = new BigDecimal(parts[2]);
                int intervalMonths = Integer.parseInt(parts[3]);
                LocalDate startDate = LocalDate.parse(parts[4]);
                LocalDate endDate = parts[5].isEmpty() ? null : LocalDate.parse(parts[5]);
                String description = parts[6];
                obligations.add(new RecurringObligation(name, categoryName, amount, intervalMonths,
                        startDate, endDate, description));
            } catch (RuntimeException e) {
                System.err.println("Skipping malformed recurring obligation line: " + line + " (" + e.getMessage() + ")");
            }
        }
    }

    private void persist() {
        List<String> lines = new ArrayList<>();
        lines.add("# name|categoryName|amount|intervalMonths|startDate|endDate|description");
        for (RecurringObligation obligation : obligations) {
            lines.add(obligation.getName() + "|" + obligation.getCategoryName() + "|" + obligation.getAmount() + "|"
                    + obligation.getIntervalMonths() + "|" + obligation.getStartDate() + "|"
                    + obligation.getEndDate().map(LocalDate::toString).orElse("") + "|"
                    + obligation.getDescription().orElse(""));
        }
        dataPaths.writeLinesAtomic(dataPaths.recurringObligationsFile(), lines);
    }
}
