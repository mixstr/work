<?php
    require(dirname(__DIR__) . '/configDB.php');

    $sql = file_get_contents(dirname(__DIR__) . '/sql/updateEmployees.sql');

    $arguments = [
        'id' => $_GET['id'],
        'FIO' => $_GET['FIO'],
        'hire_date' => $_GET['hire_date'],
        'termination_date' => $_GET['termination_date'],
    ];

    execution($sql, $arguments);
?>
