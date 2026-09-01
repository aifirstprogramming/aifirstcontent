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

    private void load() {
        for (String line : dataPaths.readLines(dataPaths.categoriesFile())) {
            if (line.isBlank() || line.startsWith("#")) {
                continue;
            }
            try {
                String[] parts = line.split("\\|", -1);
                String name = parts[0];
                BigDecimal monthlyTarget = new BigDecimal(parts[1]);
                categories.add(new Category(name, monthlyTarget));
            } catch (RuntimeException e) {
                System.err.println("Skipping malformed category line: " + line + " (" + e.getMessage() + ")");
            }
        }
    }

    private void persist() {
        List<String> lines = new ArrayList<>();
        lines.add("# name|monthlyTarget");
        for (Category category : categories) {
            lines.add(category.getName() + "|" + category.getMonthlyTarget());
        }
        dataPaths.writeLinesAtomic(dataPaths.categoriesFile(), lines);
    }
}
