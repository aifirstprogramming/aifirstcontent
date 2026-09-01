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
import javafx.scene.control.Spinner;
import javafx.scene.control.Tab;
import javafx.scene.control.TableColumn;
import javafx.scene.control.TableView;
import javafx.scene.control.TextField;
import javafx.scene.layout.HBox;
import javafx.scene.layout.VBox;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * Long-term/spread expenses (annual subscriptions, contracts): entry form,
 * the full obligations table, and what's due within the lookahead window.
 */
public class RecurringObligationsView {

    private final CategoryRepository categoryRepository;
    private final RecurringObligationRepository recurringObligationRepository;
    private final RecurringObligationService recurringObligationService;

    private final ObservableList<Category> categoryOptions = FXCollections.observableArrayList();
    private final ObservableList<RecurringObligation> obligationRows = FXCollections.observableArrayList();
    private final ObservableList<RecurringObligationService.UpcomingPayment> upcomingRows = FXCollections.observableArrayList();

    public RecurringObligationsView(CategoryRepository categoryRepository,
                                     RecurringObligationRepository recurringObligationRepository,
                                     RecurringObligationService recurringObligationService) {
        this.categoryRepository = categoryRepository;
        this.recurringObligationRepository = recurringObligationRepository;
        this.recurringObligationService = recurringObligationService;
        refresh();
    }

    public Tab asTab() {
        Tab tab = new Tab("Obligations", buildContent());
        tab.setClosable(false);
        return tab;
    }

    public void refresh() {
        categoryOptions.setAll(categoryRepository.findAll());
        obligationRows.setAll(recurringObligationRepository.findAll());
        upcomingRows.setAll(recurringObligationService.upcomingPayments(LocalDate.now()));
    }

    private VBox buildContent() {
        VBox root = new VBox(12, buildObligationForm(), new Separator(),
                new Label("Obligations"), buildObligationTable(),
                new Label("Upcoming payments (next 60 days)"), buildUpcomingTable());
        root.setPadding(new Insets(12));
        return root;
    }

    private HBox buildObligationForm() {
        TextField nameField = new TextField();
        nameField.setPromptText("Name");
        ComboBox<Category> categoryBox = new ComboBox<>(categoryOptions);
        TextField amountField = new TextField();
        amountField.setPromptText("Amount");
        Spinner<Integer> intervalSpinner = new Spinner<>(1, 12, 12);
        DatePicker startDatePicker = new DatePicker(LocalDate.now());
        DatePicker endDatePicker = new DatePicker();
        endDatePicker.setPromptText("End date (optional)");
        TextField descriptionField = new TextField();
        descriptionField.setPromptText("Notes (optional)");
        Button addButton = new Button("Add obligation");
        Label status = new Label();

        addButton.setOnAction(e -> {
            String name = nameField.getText().trim();
            Category category = categoryBox.getValue();
            LocalDate startDate = startDatePicker.getValue();
            if (name.isEmpty() || category == null || startDate == null) {
                status.setText("Name, category, and start date are required.");
                return;
            }
            try {
                BigDecimal amount = new BigDecimal(amountField.getText().trim());
                recurringObligationRepository.add(new RecurringObligation(name, category.getName(), amount,
                        intervalSpinner.getValue(), startDate, endDatePicker.getValue(),
                        descriptionField.getText().trim()));
                refresh();
                nameField.clear();
                amountField.clear();
                descriptionField.clear();
                endDatePicker.setValue(null);
                status.setText("Added obligation \"" + name + "\".");
            } catch (NumberFormatException ex) {
                status.setText("Amount must be a number.");
            }
        });

        return new HBox(8, new Label("New obligation:"), nameField, categoryBox, amountField,
                intervalSpinner, startDatePicker, endDatePicker, descriptionField, addButton, status);
    }

    private TableView<RecurringObligation> buildObligationTable() {
        TableView<RecurringObligation> table = new TableView<>(obligationRows);

        TableColumn<RecurringObligation, String> nameCol = new TableColumn<>("Name");
        nameCol.setCellValueFactory(cell -> new SimpleStringProperty(cell.getValue().getName()));

        TableColumn<RecurringObligation, String> categoryCol = new TableColumn<>("Category");
        categoryCol.setCellValueFactory(cell -> new SimpleStringProperty(cell.getValue().getCategoryName()));

        TableColumn<RecurringObligation, BigDecimal> amountCol = new TableColumn<>("Amount");
        amountCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getAmount()));

        TableColumn<RecurringObligation, Integer> intervalCol = new TableColumn<>("Every (months)");
        intervalCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getIntervalMonths()));

        TableColumn<RecurringObligation, BigDecimal> monthlyCol = new TableColumn<>("Monthly equiv.");
        monthlyCol.setCellValueFactory(cell ->
                new SimpleObjectProperty<>(recurringObligationService.monthlyEquivalent(cell.getValue())));

        TableColumn<RecurringObligation, LocalDate> startCol = new TableColumn<>("Start");
        startCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getStartDate()));

        TableColumn<RecurringObligation, String> endCol = new TableColumn<>("End");
        endCol.setCellValueFactory(cell -> new SimpleStringProperty(
                cell.getValue().getEndDate().map(LocalDate::toString).orElse("")));

        TableColumn<RecurringObligation, String> notesCol = new TableColumn<>("Notes");
        notesCol.setCellValueFactory(cell -> new SimpleStringProperty(cell.getValue().getDescription().orElse("")));

        table.getColumns().addAll(nameCol, categoryCol, amountCol, intervalCol, monthlyCol, startCol, endCol, notesCol);
        return table;
    }

    private TableView<RecurringObligationService.UpcomingPayment> buildUpcomingTable() {
        TableView<RecurringObligationService.UpcomingPayment> table = new TableView<>(upcomingRows);

        TableColumn<RecurringObligationService.UpcomingPayment, String> nameCol = new TableColumn<>("Obligation");
        nameCol.setCellValueFactory(cell -> new SimpleStringProperty(cell.getValue().getObligation().getName()));

        TableColumn<RecurringObligationService.UpcomingPayment, LocalDate> dueCol = new TableColumn<>("Due");
        dueCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getDueDate()));

        TableColumn<RecurringObligationService.UpcomingPayment, BigDecimal> amountCol = new TableColumn<>("Amount");
        amountCol.setCellValueFactory(cell -> new SimpleObjectProperty<>(cell.getValue().getObligation().getAmount()));

        table.getColumns().addAll(nameCol, dueCol, amountCol);
        return table;
    }
}
