package com.example.finance;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class GoalContributionRepository {

    private final DataPaths dataPaths;
    private final List<GoalContribution> contributions = new ArrayList<>();
    private long nextId = 1;

    public GoalContributionRepository(DataPaths dataPaths) {
        this.dataPaths = dataPaths;
        load();
    }

    public List<GoalContribution> findAll() {
        return Collections.unmodifiableList(contributions);
    }

    public GoalContribution add(LocalDate date, String goalName, BigDecimal amount) {
        GoalContribution contribution = new GoalContribution(nextId++, date, goalName, amount);
        contributions.add(contribution);
        persist();
        return contribution;
    }

    public void update(long id, LocalDate date, String goalName, BigDecimal amount) {
        for (int i = 0; i < contributions.size(); i++) {
            if (contributions.get(i).getId() == id) {
                contributions.set(i, new GoalContribution(id, date, goalName, amount));
                break;
            }
        }
        persist();
    }

    public void remove(long id) {
        contributions.removeIf(contribution -> contribution.getId() == id);
        persist();
    }

    public void renameGoal(String oldName, String newName) {
        for (int i = 0; i < contributions.size(); i++) {
            GoalContribution contribution = contributions.get(i);
            if (contribution.getGoalName().equals(oldName)) {
                contributions.set(i, new GoalContribution(contribution.getId(), contribution.getDate(), newName,
                        contribution.getAmount()));
            }
        }
        persist();
    }

    private void load() {
        for (String line : dataPaths.readLines(dataPaths.goalContributionsFile())) {
            if (line.isBlank() || line.startsWith("#")) {
                continue;
            }
            try {
                String[] parts = line.split("\\|", -1);
                long id;
                LocalDate date;
                String goalName;
                BigDecimal amount;
                // The id column is a later addition; lines written before
                // that don't have one and get a freshly assigned id.
                if (parts.length >= 4) {
                    id = Long.parseLong(parts[0]);
                    date = LocalDate.parse(parts[1]);
                    goalName = parts[2];
                    amount = new BigDecimal(parts[3]);
                } else {
                    date = LocalDate.parse(parts[0]);
                    goalName = parts[1];
                    amount = new BigDecimal(parts[2]);
                    id = nextId;
                }
                contributions.add(new GoalContribution(id, date, goalName, amount));
                if (id >= nextId) {
                    nextId = id + 1;
                }
            } catch (RuntimeException e) {
                System.err.println("Skipping malformed goal contribution line: " + line + " (" + e.getMessage() + ")");
            }
        }
    }

    private void persist() {
        List<String> lines = new ArrayList<>();
        lines.add("# id|date|goalName|amount");
        for (GoalContribution contribution : contributions) {
            lines.add(contribution.getId() + "|" + contribution.getDate() + "|" + contribution.getGoalName() + "|"
                    + contribution.getAmount());
        }
        dataPaths.writeLinesAtomic(dataPaths.goalContributionsFile(), lines);
    }
}
