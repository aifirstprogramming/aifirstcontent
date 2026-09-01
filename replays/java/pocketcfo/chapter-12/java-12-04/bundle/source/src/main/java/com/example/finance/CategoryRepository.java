package com.example.finance;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class CategoryRepository {

    private final DataPaths dataPaths;
    private final List<Category> categories = new ArrayList<>();

    public CategoryRepository(DataPaths dataPaths) {
        this.dataPaths = dataPaths;
        load();
    }

    public List<Category> findAll() {
        return Collections.unmodifiableList(categories);
    }

    public void add(Category category) {
        categories.add(category);
        persist();
    }

    public void update(String originalName, Category updated) {
        for (int i = 0; i < categories.size(); i++) {
            if (categories.get(i).getName().equals(originalName)) {
                categories.set(i, updated);
                break;
            }
        }
        persist();
    }

    public void remove(String name) {
        categories.removeIf(category -> category.getName().equals(name));
        persist();
    }

    private void load() {
        for (String line : dataPaths.readLines(dataPaths.categoriesFile())) {
            if (line.isBlank() || line.startsWith("#")) {
                continue;
            }
            try {
                String[] parts = line.split("\\|", -1);
                String name = parts[0];
                BigDecimal monthlyTarget = new BigDecimal(parts[1]);
                // Lines written before the priority column existed have only
                // two fields; a missing or blank column just means this
                // category was never prioritized. A non-numeric token is
                // corrupt data and falls through to the catch below like any
                // other malformed line.
                Integer priority = (parts.length >= 3 && !parts[2].isBlank()) ? Integer.parseInt(parts[2]) : null;
                categories.add(new Category(name, monthlyTarget, priority));
            } catch (RuntimeException e) {
                System.err.println("Skipping malformed category line: " + line + " (" + e.getMessage() + ")");
            }
        }
    }

    private void persist() {
        List<String> lines = new ArrayList<>();
        lines.add("# name|monthlyTarget|priority");
        for (Category category : categories) {
            lines.add(category.getName() + "|" + category.getMonthlyTarget() + "|"
                    + category.getPriority().map(String::valueOf).orElse(""));
        }
        dataPaths.writeLinesAtomic(dataPaths.categoriesFile(), lines);
    }
}
