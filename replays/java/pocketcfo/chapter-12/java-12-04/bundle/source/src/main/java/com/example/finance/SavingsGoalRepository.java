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

    public void update(String originalName, SavingsGoal updated) {
        for (int i = 0; i < goals.size(); i++) {
            if (goals.get(i).getName().equals(originalName)) {
                goals.set(i, updated);
                break;
            }
        }
        persist();
    }

    public void remove(String name) {
        goals.removeIf(goal -> goal.getName().equals(name));
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
                // Lines written before goals pointed at an existing category
                // lack this column; default to the goal's own name, which
                // matches the pseudo-category that used to be auto-created.
                String categoryName = (parts.length >= 4 && !parts[3].isEmpty()) ? parts[3] : name;
                goals.add(new SavingsGoal(name, targetAmount, targetDate, categoryName));
            } catch (RuntimeException e) {
                System.err.println("Skipping malformed savings goal line: " + line + " (" + e.getMessage() + ")");
            }
        }
    }

    private void persist() {
        List<String> lines = new ArrayList<>();
        lines.add("# name|targetAmount|targetDate|categoryName");
        for (SavingsGoal goal : goals) {
            lines.add(goal.getName() + "|" + goal.getTargetAmount() + "|"
                    + goal.getTargetDate().map(LocalDate::toString).orElse("") + "|" + goal.getCategoryName());
        }
        dataPaths.writeLinesAtomic(dataPaths.savingsGoalsFile(), lines);
    }

    public void renameCategory(String oldName, String newName) {
        for (int i = 0; i < goals.size(); i++) {
            SavingsGoal goal = goals.get(i);
            if (goal.getCategoryName().equals(oldName)) {
                goals.set(i, new SavingsGoal(goal.getName(), goal.getTargetAmount(),
                        goal.getTargetDate().orElse(null), newName));
            }
        }
        persist();
    }
}
