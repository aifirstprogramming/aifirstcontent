# Personal Finance App

A desktop "awareness budgeting" app: record transactions, compare category spending against monthly targets, allocate leftover income to savings goals, and track long-term/annual obligations. JavaFX UI, Maven build, JUnit 5 tests.

## Quick start

```bash
# From the project root
mvn javafx:run

# Run tests
mvn -q test
```

Data is stored outside the project, in `~/.personal-finance-app/data/`, as plain pipe-delimited text files (one per entity) — it survives between runs and isn't part of the repo.

## Structure

Built up in layers; see the plan for the full rationale.

1. **Data entry** — `TransactionType`, `Category`, `Transaction`, `DataPaths`, `CategoryRepository`, `TransactionRepository`, `MainApp`, `TransactionEntryView`
2. **Category allocation** — `BudgetService`, `CategorySummaryView`
3. **Savings goals** — `SavingsGoal`, `GoalContribution`, `SavingsGoalRepository`, `GoalContributionRepository`, `SavingsGoalService`, `SavingsGoalsView`
4. **Long-term obligations** — `RecurringObligation`, `RecurringObligationRepository`, `RecurringObligationService`, `RecurringObligationsView`
5. **Month summary** — `MonthSummaryService`, `MonthSummaryView`

All source under `src/main/java/com/example/finance`, tests under `src/test/java/com/example/finance`.
