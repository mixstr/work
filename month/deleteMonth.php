<?php
    require(dirname(__DIR__) . '/configDB.php');

    $deleteMonthSql = file_get_contents(dirname(__DIR__) . '/sql/deleteMonth.sql');
    $deleteCascadeSql = file_get_contents(dirname(__DIR__) . '/sql/deleteMonthCascade.sql');

    $arguments= [
        'id' => $_GET['id']
    ];

    execution($deleteMonthSql, $arguments);
    execution($deleteCascadeSql, $arguments);
?>
