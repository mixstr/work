<?php
    require 'configDB.php';
    $sql = 'UPDATE employees SET termination_date = :termination_date WHERE id = :id';
    $query = $databasehandler->prepare($sql);
    $query->execute(['termination_date'=>"20.07.2020", 'id'=> 8]);
    ?>

