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
import javafx.scene.layout.FlowPane;
import javafx.scene.layout.VBox;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;

/**
 * Create/edit/delete savings goals, with a table of each goal's saved
 * amount and progress, plus create/edit/delete for the individual leftover
 * allocations that make up those saved amounts.
 */
public class SavingsGoalsView {

    private final SavingsGoalRepository savingsGoalRepository;
    private final GoalContributionRepository goalContributionRepository;
    private final SavingsGoalService savingsGoalService;
    private final CategoryRepository categoryRepository;
    private final YearMonth month;

    private final ObservableList<SavingsGoal> goalOptions = FXCollections.observableArrayList();
    private final ObservableList<Category> categoryOptions = FXCollections.observableArrayList();
    private final ObservableList<SavingsGoalService.GoalProgress> rows = FXCollections.observableArrayList();
    private final ObservableList<GoalContribution> contributionRows = FXCollections.observableArrayList();
    private final Label leftoverLabel = new Label();

    public SavingsGoalsView(SavingsGoalRepository savingsGoalRepository,
                             GoalContributionRepository goalContributionRepository,
                             SavingsGoalService savingsGoalService,
                             CategoryRepository categoryRepository) {
        this(savingsGoalRepository, goalContributionRepository, savingsGoalService, categoryRepository,
                YearMonth.now());
    }

    public SavingsGoalsView(SavingsGoalRepository savingsGoalRepository,
                             GoalContributionRepository goalContributionRepository,
                             SavingsGoalService savingsGoalService,
                             CategoryRepository categoryRepository, YearMonth month) {
        this.savingsGoalRepository = savingsGoalRepository;
        this.goalContributionRepository = goalContributionRepository;
        this.savingsGoalService = savingsGoalService;
        this.categoryRepository = categoryRepository;
        this.month = month;
        leftoverLabel.setWrapText(true);
        refresh();
    }

    public Tab asTab() {
        Tab tab = new Tab("Savings Goals", buildContent());
        tab.setClosable(false);
        return tab;
    }

    public void refresh() {
        goalOptions.setAll(savingsGoalRepository.findAll());
        categoryOptions.setAll(categoryRepository.findAll());
        rows.setAll(savingsGoalService.goalProgress());
        contributionRows.setAll(goalContributionRepository.findAll());
        leftoverLabel.setText("Available leftover this month: " + savingsGoalService.availableLeftover(month));
    }

    private VBox buildContent() {
        VBox root = new VBox(12, buildGoalManagement(), new Separator(), leftoverLabel, buildAllocationManagement());
        root.setPadding(new Insets(12));
        return root;
    }

    private VBox buildGoalManagement() {
        TextField nameField = new TextField();
        nameField.setPromptText("Goal name");
        TextField targetField = new TextField();
        targetField.setPromptText("Target amount");
        DatePicker targetDatePicker = new DatePicker();
        targetDatePicker.setPromptText("Target date (optional)");
        ComboBox<Category> categoryBox = new ComboBox<>(categoryOptions);
        categoryBox.setPromptText("Category");
        Label status = new Label();
        status.setWrapText(true);

        TableView<SavingsGoalService.GoalProgress> table = buildGoalTable();

        Button saveButton = new Button("Add goal");
        Button deleteButton = new Button("Delete selected");
        deleteButton.setDisable(true);

        table.getSelectionModel().selectedItemProperty().addListener((obs, oldSelection, newSelection) -> {
            if (newSelection != null) {
                SavingsGoal goal = newSelection.getGoal();
                nameField.setText(goal.getName());
                targetField.setText(goal.getTargetAmount().toString());
                targetDatePicker.setValue(goal.getTargetDate().orElse(null));
                categoryOptions.stream()
                        .filter(c -> c.getName().equals(goal.getCategoryName()))
                        .findFirst()
                        .ifPresent(categoryBox::setValue);
                saveButton.setText("Update goal");
                deleteButton.setDisable(false);
            } else {
                saveButton.setText("Add goal");
                deleteButton.setDisable(true);
                categoryBox.setValue(null);
            }
        });

        saveButton.setOnAction(e -> {
            String name = nameField.getText().trim();
            if (name.isEmpty()) {
                status.setText("Goal name is required.");
                return;
            }
            Category category = categoryBox.getValue();
            if (category == null) {
                status.setText("Category is required.");
                return;
            }
            try {
                BigDecimal target = new BigDecimal(targetField.getText().trim());
                SavingsGoalService.GoalProgress selected = table.getSelectionModel().getSelectedItem();
                SavingsGoal updated = new SavingsGoal(name, target, targetDatePicker.getValue(), category.getName());
                if (selected == null) {
                    savingsGoalService.addGoal(updated);
                    status.setText("Added goal \"" + name + "\".");
                } else {
                    savingsGoalService.updateGoal(selected.getGoal().getName(), updated);
                    status.setText("Updated goal \"" + name + "\".");
                }
                table.getSelectionModel().clearSelection();
                nameField.clear();
                targetField.clear();
                targetDatePicker.setValue(null);
                categoryBox.setValue(null);
                refresh();
            } catch (NumberFormatException ex) {
                status.setText("Target amount must be a number.");
            } catch (IllegalArgumentException ex) {
                status.setText(ex.getMessage());
            }
        });

        deleteButton.setOnAction(e -> {
            SavingsGoalService.GoalProgress selected = table.getSelectionModel().getSelectedItem();
            if (selected == null) {
                return;
            }
            try {
                savingsGoalService.deleteGoal(selected.getGoal().getName());
                table.getSelectionModel().clearSelection();
                nameField.clear();
                targetField.clear();
                targetDatePicker.setValue(null);
                categoryBox.setValue(null);
                status.setText("Deleted goal \"" + selected.getGoal().getName() + "\".");
                refresh();
            } catch (IllegalStateException ex) {
                status.setText(ex.getMessage());
            }
        });

        FlowPane form = new FlowPane(8, 8, new Label("Goal:"), nameField, targetField, targetDatePicker, categoryBox,
                saveButton, deleteButton, status);
        VBox root = new VBox(6, form, table);
        TableSelectionUtil.clearSelectionOnClickOutside(root, table);
        return root;
    }

    private VBox buildAllocationManagement() {
        ComboBox<SavingsGoal> goalBox = new ComboBox<>(goalOptions);
        DatePicker datePicker = new DatePicker(LocalDate.now());
        TextField amountField = new TextField();
        amountField.setPromptText("Amount");
        Label status = new Label();
        status.setWrapText(true);

        TableView<GoalContribution> table = buildContributionsTable();

        Button saveButton = new Button("Allocate to goal");
        Button deleteButton = new Button("Delete selected");
        deleteButton.setDisable(true);

        table.getSelectionModel().selectedItemProperty().addListener((obs, oldSelection, newSelection) -> {
            if (newSelection != null) {
                goalOptions.stream()
                        .filter(g -> g.getName().equals(newSelection.getGoalName()))
                        .findFirst()
                        .ifPresent(goalBox::setValue);
                datePicker.setValue(newSelection.getDate());
                amountField.setText(newSelection.getAmount().toString());
                saveButton.setText("Update allocation");
                deleteButton.setDisable(false);
            } else {
                saveButton.setText("Allocate to goal");
                deleteButton.setDisable(true);
            }
        });

        saveButton.setOnAction(e -> {
            SavingsGoal goal = goalBox.getValue();
            LocalDate date = datePicker.getValue();
            if (goal == null || date == null) {
                status.setText("Choose a goal and date.");
                return;
            }
            try {
                BigDecimal amount = new BigDecimal(amountField.getText().trim());
                GoalContribution selected = table.getSelectionModel().getSelectedItem();
                if (selected == null) {
                    savingsGoalService.allocateLeftoverToGoal(goal.getName(), amount, month);
                    status.setText("Allocated " + amount + " to \"" + goal.getName() + "\".");
                } else {
                    savingsGoalService.updateContribution(selected.getId(), date, goal.getName(), amount, month);
                    status.setText("Updated allocation.");
                }
                table.getSelectionModel().clearSelection();
                amountField.clear();
                refresh();
            } catch (NumberFormatException ex) {
                status.setText("Amount must be a number.");
            } catch (IllegalArgumentException ex) {
                status.setText(ex.getMessage());
            }
        });

        deleteButton.setOnAction(e -> {
            GoalContribution selected = table.getSelectionModel().getSelectedItem();
            if (selected == null) {
                return;
            }
            savingsGoalService.deleteContribution(selected.getId());
            table.getSelectionModel().clearSelection();
            amountField.clear();
            status.setText("Deleted allocation.");
            refresh();
        });

        FlowPane form = new FlowPane(8, 8, new Label("Allocate leftover:"), goalBox, datePicker, amountField,
                saveButton, deleteButton, status);
        VBox root = new VBox(6, form, table);
        TableSelectionUtil.clearSelectionOnClickOutside(root, table);
        return root;
    }

    private TableView<SavingsGoalService.GoalProgress> buildGoalTable() {
        TableView<SavingsGoalService.GoalProgress> table = new TableView<>(rows);

        TableColumn<SavingsGoalService.GoalProgress, String> nameCol = new TableColumn<>("Goal");
        nameCol.setCellValueFactory(cell -> new SimpleStringProperty(cell.getValue().getGoal().getName()));

        TableColumn<SavingsGoalService.GoalProgress, String> categoryCol = new TableColumn<>("Category");
        categoryCol.setCellValueFactory(cell -> new SimpleStringProperty(cell.getValue().getGoal().getCategoryName()));

        TableColumn<SavingsGoalService.GoalProgress, BigDecimal> targetCol = new TableColumn<>("Target");
        targetCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getGoal().getTargetAmount()));

        TableColumn<SavingsGoalService.GoalProgress, BigDecimal> savedCol = new TableColumn<>("Saved");
        savedCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getSavedAmount()));

        TableColumn<SavingsGoalService.GoalProgress, String> percentCol = new TableColumn<>("Progress");
        percentCol.setCellValueFactory(cell -> new SimpleStringProperty(
                String.format("%.0f%%", cell.getValue().getPercentComplete() * 100)));

        table.getColumns().addAll(nameCol, categoryCol, targetCol, savedCol, percentCol);
        return table;
    }

    private TableView<GoalContribution> buildContributionsTable() {
        TableView<GoalContribution> table = new TableView<>(contributionRows);

        TableColumn<GoalContribution, LocalDate> dateCol = new TableColumn<>("Date");
        dateCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getDate()));

        TableColumn<GoalContribution, String> goalCol = new TableColumn<>("Goal");
        goalCol.setCellValueFactory(cell -> new SimpleStringProperty(cell.getValue().getGoalName()));

        TableColumn<GoalContribution, BigDecimal> amountCol = new TableColumn<>("Amount");
        amountCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getAmount()));

        table.getColumns().addAll(dateCol, goalCol, amountCol);
        return table;
    }
}
