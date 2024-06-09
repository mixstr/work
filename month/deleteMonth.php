<?php
    require_once(dirname(__DIR__) . '/configDB.php');
    $sqlMonthID = file_get_contents(dirname(__DIR__) . '/sql/deleteMonth.sql');
    $sqlCascade = file_get_contents(dirname(__DIR__) . '/sql/deleteMonthCascade.sql');
    $arguments= [
        'id' => $_GET['id']
    ];
    execution($sqlMonthID, $arguments);
    execution($sqlCascade, $arguments);
?>
