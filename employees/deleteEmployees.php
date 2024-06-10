<?php
    require_once(dirname(__DIR__) . '/configDB.php');
    $deleteEmployees = file_get_contents(dirname(__DIR__) . '/sql/deleteEmployees.sql');
    $monthIds = array();
    $arguments= [
        'id' => $_GET['id']
    ];
    $sqlMonthID = file_get_contents(dirname(__DIR__) . '/sql/cascadeMonthToEmployees.sql');
    $result = execution($sqlMonthID, $arguments);
    $monthIds = $result->fetchAll(PDO::FETCH_COLUMN);
    $monthIds = array_unique($monthIds);
    $deleteMonth = file_get_contents(dirname(__DIR__) . '/sql/deleteMonth.sql');

    foreach ($monthIds as &$value) {
        execution($deleteMonth, $value);
    }

    $deleteCoefficient = file_get_contents(dirname(__DIR__) . '/sql/deleteEmployeesCascadeCoefficient.sql');
    execution($deleteCoefficient, $arguments);
    execution($deleteEmployees, $arguments);
?>
