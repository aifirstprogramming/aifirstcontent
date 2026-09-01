package com.example.finance;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class GoalContributionRepository {

    private final DataPaths dataPaths;
    private final List<GoalContribution> contributions = new ArrayList<>();

    public GoalContributionRepository(DataPaths dataPaths) {
        this.dataPaths = dataPaths;
        load();
    }

    public List<GoalContribution> findAll() {
        return Collections.unmodifiableList(contributions);
    }

    public GoalContribution add(LocalDate date, String goalName, BigDecimal amount) {
        GoalContribution contribution = new GoalContribution(date, goalName, amount);
        contributions.add(contribution);
        persist();
        return contribution;
    }

    private void load() {
        for (String line : dataPaths.readLines(dataPaths.goalContributionsFile())) {
            if (line.isBlank() || line.startsWith("#")) {
                continue;
            }
            try {
                String[] parts = line.split("\\|", -1);
                LocalDate date = LocalDate.parse(parts[0]);
                String goalName = parts[1];
                BigDecimal amount = new BigDecimal(parts[2]);
                contributions.add(new GoalContribution(date, goalName, amount));
            } catch (RuntimeException e) {
                System.err.println("Skipping malformed goal contribution line: " + line + " (" + e.getMessage() + ")");
            }
        }
    }

    private void persist() {
        List<String> lines = new ArrayList<>();
        lines.add("# date|goalName|amount");
        for (GoalContribution contribution : contributions) {
            lines.add(contribution.getDate() + "|" + contribution.getGoalName() + "|" + contribution.getAmount());
        }
        dataPaths.writeLinesAtomic(dataPaths.goalContributionsFile(), lines);
    }
}
