<?php
    require(dirname(__DIR__) . '/configDB.php');

    $deleteCoefficient = file_get_contents(dirname(__DIR__) . '/sql/deleteCoefficient.sql');
    $deleteCascadeSql = file_get_contents(dirname(__DIR__) . '/sql/deleteCoefficientCascade.sql');

    $arguments= [
        'id' => $_GET['id']
    ];

    execution($deleteCoefficient, $arguments);
    execution($deleteCascadeSql, $arguments);
?>
