package com.example.finance;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class SavingsGoalRepository {

    private final DataPaths dataPaths;
    private final List<SavingsGoal> goals = new ArrayList<>();

    public SavingsGoalRepository(DataPaths dataPaths) {
        this.dataPaths = dataPaths;
        load();
    }

    public List<SavingsGoal> findAll() {
        return Collections.unmodifiableList(goals);
    }

    public void add(SavingsGoal goal) {
        goals.add(goal);
        persist();
    }

    private void load() {
        for (String line : dataPaths.readLines(dataPaths.savingsGoalsFile())) {
            if (line.isBlank() || line.startsWith("#")) {
                continue;
            }
            try {
                String[] parts = line.split("\\|", -1);
                String name = parts[0];
                BigDecimal targetAmount = new BigDecimal(parts[1]);
                LocalDate targetDate = parts[2].isEmpty() ? null : LocalDate.parse(parts[2]);
                goals.add(new SavingsGoal(name, targetAmount, targetDate));
            } catch (RuntimeException e) {
                System.err.println("Skipping malformed savings goal line: " + line + " (" + e.getMessage() + ")");
            }
        }
    }

    private void persist() {
        List<String> lines = new ArrayList<>();
        lines.add("# name|targetAmount|targetDate");
        for (SavingsGoal goal : goals) {
            lines.add(goal.getName() + "|" + goal.getTargetAmount() + "|"
                    + goal.getTargetDate().map(LocalDate::toString).orElse(""));
        }
        dataPaths.writeLinesAtomic(dataPaths.savingsGoalsFile(), lines);
    }
}
