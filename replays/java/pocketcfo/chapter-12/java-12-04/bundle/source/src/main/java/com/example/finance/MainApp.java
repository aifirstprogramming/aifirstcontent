package com.example.finance;

import javafx.application.Application;
import javafx.beans.property.ObjectProperty;
import javafx.beans.property.SimpleObjectProperty;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.Scene;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.control.TabPane;
import javafx.scene.layout.HBox;
import javafx.scene.layout.VBox;
import javafx.stage.Stage;

import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

public class MainApp extends Application {

    @Override
    public void start(Stage stage) {
        ObjectProperty<YearMonth> selectedMonth = new SimpleObjectProperty<>(YearMonth.now());

        DataPaths dataPaths = new DataPaths();
        CategoryRepository categoryRepository = new CategoryRepository(dataPaths);
        TransactionRepository transactionRepository = new TransactionRepository(dataPaths);
        RecurringObligationRepository recurringObligationRepository = new RecurringObligationRepository(dataPaths);
        SavingsGoalRepository savingsGoalRepository = new SavingsGoalRepository(dataPaths);
        GoalContributionRepository goalContributionRepository = new GoalContributionRepository(dataPaths);
        CategoryService categoryService = new CategoryService(
                categoryRepository, transactionRepository, recurringObligationRepository, savingsGoalRepository);
        RecurringObligationService recurringObligationService = new RecurringObligationService(
                recurringObligationRepository, transactionRepository, categoryRepository);
        BudgetService budgetService = new BudgetService(
                categoryRepository, transactionRepository, savingsGoalRepository, recurringObligationRepository);
        PriorityAlignmentService priorityAlignmentService = new PriorityAlignmentService(budgetService);
        SavingsGoalService savingsGoalService = new SavingsGoalService(
                savingsGoalRepository, goalContributionRepository, budgetService, categoryRepository);
        MonthSummaryService monthSummaryService = new MonthSummaryService(
                budgetService, savingsGoalService, recurringObligationService, priorityAlignmentService);

        MonthSummaryView monthSummaryView = new MonthSummaryView(monthSummaryService, selectedMonth);
        TransactionEntryView transactionEntryView = new TransactionEntryView(
                categoryRepository, transactionRepository, savingsGoalRepository, recurringObligationRepository,
                selectedMonth);
        CategorySummaryView categorySummaryView = new CategorySummaryView(
                categoryRepository, categoryService, budgetService, selectedMonth);
        SavingsGoalsView savingsGoalsView = new SavingsGoalsView(
                savingsGoalRepository, goalContributionRepository, savingsGoalService, categoryRepository);
        RecurringObligationsView recurringObligationsView = new RecurringObligationsView(
                recurringObligationRepository, recurringObligationService, categoryRepository);

        TabPane tabPane = new TabPane();
        tabPane.getTabs().addAll(
                monthSummaryView.asTab(),
                transactionEntryView.asTab(),
                categorySummaryView.asTab(),
                savingsGoalsView.asTab(),
                recurringObligationsView.asTab());

        // Entering any tab re-pulls the latest data, since transactions/goals/
        // obligations/categories entered in one tab feed the totals shown in the others.
        tabPane.getSelectionModel().selectedItemProperty().addListener((obs, oldTab, newTab) -> {
            transactionEntryView.refresh();
            categorySummaryView.refresh();
            savingsGoalsView.refresh();
            recurringObligationsView.refresh();
            monthSummaryView.refresh();
        });

        // Only the three month-scoped views need to react to month navigation;
        // Savings Goals and Recurring Obligations aren't month-scoped.
        selectedMonth.addListener((obs, oldMonth, newMonth) -> {
            monthSummaryView.refresh();
            transactionEntryView.refresh();
            categorySummaryView.refresh();
        });

        VBox mainLayout = new VBox(buildMonthNavigationBar(selectedMonth), tabPane);

        stage.setTitle("Personal Finance");
        stage.setScene(new Scene(mainLayout, 1024, 720));
        stage.show();
    }

    private HBox buildMonthNavigationBar(ObjectProperty<YearMonth> selectedMonth) {
        Label monthLabel = new Label();
        DateTimeFormatter formatter = DateTimeFormatter.ofPattern("MMMM yyyy", Locale.ROOT);
        monthLabel.setText(selectedMonth.get().format(formatter));
        selectedMonth.addListener((obs, oldMonth, newMonth) -> monthLabel.setText(newMonth.format(formatter)));

        Button previousButton = new Button("< Previous");
        previousButton.setOnAction(e -> selectedMonth.set(selectedMonth.get().minusMonths(1)));
        Button todayButton = new Button("Today");
        todayButton.setOnAction(e -> selectedMonth.set(YearMonth.now()));
        Button nextButton = new Button("Next >");
        nextButton.setOnAction(e -> selectedMonth.set(selectedMonth.get().plusMonths(1)));

        HBox navBar = new HBox(8, previousButton, monthLabel, nextButton, todayButton);
        navBar.setPadding(new Insets(12));
        navBar.setAlignment(Pos.CENTER_LEFT);
        return navBar;
    }

    public static void main(String[] args) {
        launch(args);
    }
}
