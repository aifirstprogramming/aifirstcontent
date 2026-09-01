package com.example.finance;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.List;

/**
 * Where finance data lives on disk, and the shared load/save plumbing every
 * repository uses. Defaults to a directory outside the project so it survives
 * across sessions regardless of where the project itself is checked out.
 */
public class DataPaths {

    private final Path dataDir;

    public DataPaths() {
        this(Path.of(System.getProperty("user.home"), ".personal-finance-app", "data"));
    }

    public DataPaths(Path dataDir) {
        this.dataDir = dataDir;
    }

    public Path categoriesFile() {
        return dataDir.resolve("categories.txt");
    }

    public Path transactionsFile() {
        return dataDir.resolve("transactions.txt");
    }

    public Path savingsGoalsFile() {
        return dataDir.resolve("savings_goals.txt");
    }

    public Path goalContributionsFile() {
        return dataDir.resolve("goal_contributions.txt");
    }

    public Path recurringObligationsFile() {
        return dataDir.resolve("recurring_obligations.txt");
    }

    public List<String> readLines(Path file) {
        try {
            if (!Files.exists(file)) {
                return List.of();
            }
            return Files.readAllLines(file);
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to read " + file, e);
        }
    }

    public void writeLinesAtomic(Path file, List<String> lines) {
        try {
            Files.createDirectories(dataDir);
            Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
            Files.write(tmp, lines);
            Files.move(tmp, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to write " + file, e);
        }
    }
}
