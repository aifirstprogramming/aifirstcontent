package com.example.finance;

import javafx.beans.property.SimpleObjectProperty;
import javafx.beans.property.SimpleStringProperty;
import javafx.collections.FXCollections;
import javafx.collections.ObservableList;
import javafx.geometry.Insets;
import javafx.scene.control.Button;
import javafx.scene.control.ComboBox;
import javafx.scene.control.DatePicker;
import javafx.scene.control.Label;
import javafx.scene.control.Separator;
import javafx.scene.control.Tab;
import javafx.scene.control.TableColumn;
import javafx.scene.control.TableView;
import javafx.scene.control.TextField;
import javafx.scene.layout.HBox;
import javafx.scene.layout.VBox;

import java.math.BigDecimal;
import java.time.YearMonth;

/**
 * Create savings goals and allocate the current month's leftover to them,
 * with a table of each goal's saved amount and progress.
 */
public class SavingsGoalsView {

    private final SavingsGoalRepository savingsGoalRepository;
    private final SavingsGoalService savingsGoalService;
    private final YearMonth month;

    private final ObservableList<SavingsGoal> goalOptions = FXCollections.observableArrayList();
    private final ObservableList<SavingsGoalService.GoalProgress> rows = FXCollections.observableArrayList();
    private final Label leftoverLabel = new Label();

    public SavingsGoalsView(SavingsGoalRepository savingsGoalRepository, SavingsGoalService savingsGoalService) {
        this(savingsGoalRepository, savingsGoalService, YearMonth.now());
    }

    public SavingsGoalsView(SavingsGoalRepository savingsGoalRepository, SavingsGoalService savingsGoalService,
                             YearMonth month) {
        this.savingsGoalRepository = savingsGoalRepository;
        this.savingsGoalService = savingsGoalService;
        this.month = month;
        refresh();
    }

    public Tab asTab() {
        Tab tab = new Tab("Savings Goals", buildContent());
        tab.setClosable(false);
        return tab;
    }

    public void refresh() {
        goalOptions.setAll(savingsGoalRepository.findAll());
        rows.setAll(savingsGoalService.goalProgress());
        leftoverLabel.setText("Available leftover this month: " + savingsGoalService.availableLeftover(month));
    }

    private VBox buildContent() {
        VBox root = new VBox(12, buildGoalForm(), new Separator(), leftoverLabel, buildAllocationForm(), buildGoalTable());
        root.setPadding(new Insets(12));
        return root;
    }

    private HBox buildGoalForm() {
        TextField nameField = new TextField();
        nameField.setPromptText("Goal name");
        TextField targetField = new TextField();
        targetField.setPromptText("Target amount");
        DatePicker targetDatePicker = new DatePicker();
        targetDatePicker.setPromptText("Target date (optional)");
        Button addButton = new Button("Add goal");
        Label status = new Label();

        addButton.setOnAction(e -> {
            String name = nameField.getText().trim();
            if (name.isEmpty()) {
                status.setText("Goal name is required.");
                return;
            }
            try {
                BigDecimal target = new BigDecimal(targetField.getText().trim());
                savingsGoalRepository.add(new SavingsGoal(name, target, targetDatePicker.getValue()));
                refresh();
                nameField.clear();
                targetField.clear();
                targetDatePicker.setValue(null);
                status.setText("Added goal \"" + name + "\".");
            } catch (NumberFormatException ex) {
                status.setText("Target amount must be a number.");
            }
        });

        return new HBox(8, new Label("New goal:"), nameField, targetField, targetDatePicker, addButton, status);
    }

    private HBox buildAllocationForm() {
        ComboBox<SavingsGoal> goalBox = new ComboBox<>(goalOptions);
        TextField amountField = new TextField();
        amountField.setPromptText("Amount");
        Button allocateButton = new Button("Allocate to goal");
        Label status = new Label();

        allocateButton.setOnAction(e -> {
            SavingsGoal goal = goalBox.getValue();
            if (goal == null) {
                status.setText("Choose a goal.");
                return;
            }
            try {
                BigDecimal amount = new BigDecimal(amountField.getText().trim());
                savingsGoalService.allocateLeftoverToGoal(goal.getName(), amount, month);
                refresh();
                amountField.clear();
                status.setText("Allocated " + amount + " to \"" + goal.getName() + "\".");
            } catch (NumberFormatException ex) {
                status.setText("Amount must be a number.");
            } catch (IllegalArgumentException ex) {
                status.setText(ex.getMessage());
            }
        });

        return new HBox(8, new Label("Allocate leftover:"), goalBox, amountField, allocateButton, status);
    }

    private TableView<SavingsGoalService.GoalProgress> buildGoalTable() {
        TableView<SavingsGoalService.GoalProgress> table = new TableView<>(rows);

        TableColumn<SavingsGoalService.GoalProgress, String> nameCol = new TableColumn<>("Goal");
        nameCol.setCellValueFactory(cell -> new SimpleStringProperty(cell.getValue().getGoal().getName()));

        TableColumn<SavingsGoalService.GoalProgress, BigDecimal> targetCol = new TableColumn<>("Target");
        targetCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getGoal().getTargetAmount()));

        TableColumn<SavingsGoalService.GoalProgress, BigDecimal> savedCol = new TableColumn<>("Saved");
        savedCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getSavedAmount()));

        TableColumn<SavingsGoalService.GoalProgress, String> percentCol = new TableColumn<>("Progress");
        percentCol.setCellValueFactory(cell -> new SimpleStringProperty(
                String.format("%.0f%%", cell.getValue().getPercentComplete() * 100)));

        table.getColumns().addAll(nameCol, targetCol, savedCol, percentCol);
        return table;
    }
}
